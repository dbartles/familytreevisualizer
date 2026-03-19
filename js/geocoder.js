/**
 * GeocodingService — Geocode place strings to lat/lng using Nominatim (OpenStreetMap)
 *
 * Cache layers (checked in order):
 *   1. In-memory Map (instant, current session)
 *   2. data/geocache.json (file shipped with the app — shared with all visitors)
 *   3. localStorage (browser-local fallback)
 *
 * After geocoding new places, use exportCacheAsJSON() to download an updated
 * geocache.json and place it in data/ so future visitors skip geocoding entirely.
 *
 * Rate limited to 1 request per 1.1 seconds to respect Nominatim's usage policy.
 */

class GeocodingService {
    constructor() {
        this.cache = new Map();
        this.CACHE_PREFIX = 'ftv_geo_';
        this._fileLoaded = false;   // whether geocache.json has been loaded
        this._newEntries = 0;       // entries added since last export
        this._loadCacheFromStorage();
    }

    /**
     * Load the shipped geocache.json file into cache.
     * Call this once at startup before geocoding.
     * Returns the number of entries loaded.
     */
    async loadFromFile(path) {
        try {
            // Cache-bust to avoid stale browser HTTP cache
            const url = (path || 'data/geocache.json') + '?v=' + Date.now();
            const resp = await fetch(url);
            if (!resp.ok) {
                console.log('Geocache file not found (HTTP ' + resp.status + ')');
                return 0;
            }
            const data = await resp.json();
            let count = 0;
            for (const [place, coord] of Object.entries(data)) {
                if (!this.cache.has(place)) {
                    this.cache.set(place, coord); // coord is {lat,lng} or null
                    count++;
                }
            }
            this._fileLoaded = true;
            console.log('Geocache loaded: ' + count + ' new entries from file (' + Object.keys(data).length + ' total in file)');
            return count;
        } catch (e) {
            console.log('Geocache file not available:', e.message);
            return 0;
        }
    }

    /**
     * Load cached geocoding results from localStorage into memory
     */
    _loadCacheFromStorage() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.CACHE_PREFIX)) {
                    const place = key.substring(this.CACHE_PREFIX.length);
                    const value = JSON.parse(localStorage.getItem(key));
                    this.cache.set(place, value);
                }
            }
        } catch (e) {
            // localStorage may be unavailable
        }
    }

    /**
     * Save a result to both in-memory cache and localStorage
     */
    _saveToCache(normalizedPlace, result) {
        const existing = this.cache.get(normalizedPlace);
        const isNew = !this.cache.has(normalizedPlace);
        const isCorrection = !isNew && (
            (existing === null && result !== null) ||
            (existing && result && (existing.lat !== result.lat || existing.lng !== result.lng))
        );
        if (isNew || isCorrection) {
            this._newEntries++;
        }
        this.cache.set(normalizedPlace, result);
        try {
            localStorage.setItem(this.CACHE_PREFIX + normalizedPlace, JSON.stringify(result));
        } catch (e) {
            // localStorage full or unavailable — in-memory cache still works
        }
    }

    /**
     * Export the full cache as a JSON object (for saving to geocache.json).
     * Includes both successful results AND null entries (failed lookups),
     * so new visitors don't re-attempt places that are known to have no result.
     */
    exportCacheAsJSON() {
        const obj = {};
        for (const [place, coord] of this.cache) {
            obj[place] = coord; // coord is {lat,lng} or null
        }
        return JSON.stringify(obj, null, 2);
    }

    /**
     * Trigger a browser download of the geocache JSON file.
     */
    downloadCacheFile() {
        const json = this.exportCacheAsJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'geocache.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this._newEntries = 0;
    }

    /**
     * Whether there are new geocoded entries that haven't been saved to file yet.
     */
    get hasNewEntries() {
        return this._newEntries > 0;
    }

    /**
     * Normalize a place string for consistent cache keys:
     * - lowercase
     * - strip "near", "of", "about", "probably" prefixes
     * - collapse whitespace
     * - strip non-alphanumeric except commas and spaces
     */
    normalizePlaceString(place) {
        if (!place) return '';
        let s = place.toLowerCase().trim();
        // Remove common prefixes
        s = s.replace(/^(near|of|about|probably|possibly|circa|ca\.?|abt\.?)\s+/gi, '');
        // Strip non-alphanumeric except commas, spaces, hyphens
        s = s.replace(/[^a-z0-9, \-]/g, '');
        // Collapse whitespace
        s = s.replace(/\s+/g, ' ').trim();
        return s;
    }

    /**
     * Geocode a single place string. Returns {lat, lng} or null.
     * Uses cache first, then fetches from Nominatim.
     */
    async geocodePlace(place) {
        const normalized = this.normalizePlaceString(place);
        if (!normalized) return null;

        // Check cache (including cached nulls for known failures)
        if (this.cache.has(normalized)) {
            return this.cache.get(normalized);
        }

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(normalized)}`;
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'FamilyTreeVisualizer/1.0' }
            });

            if (!resp.ok) {
                this._saveToCache(normalized, null);
                return null;
            }

            const data = await resp.json();

            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);

                // Filter out [0,0] coordinates (usually errors)
                if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) {
                    this._saveToCache(normalized, null);
                    return null;
                }

                const result = { lat, lng };
                this._saveToCache(normalized, result);
                return result;
            } else {
                // Cache the miss so we don't re-request
                this._saveToCache(normalized, null);
                return null;
            }
        } catch (e) {
            // Network error — cache null to avoid hammering on repeated failures
            this._saveToCache(normalized, null);
            return null;
        }
    }

    /**
     * Batch geocode an array of place strings sequentially with rate limiting.
     * @param {string[]} places - Array of place strings
     * @param {function} progressCallback - Called with (completed, total) after each geocode
     * @returns {Map<string, {lat, lng}>} Map from original place string to coordinates
     */
    async batchGeocode(places, progressCallback) {
        const results = new Map();
        const uncached = [];

        // Separate cached from uncached
        for (const place of places) {
            const normalized = this.normalizePlaceString(place);
            if (!normalized) continue;

            if (this.cache.has(normalized)) {
                const cached = this.cache.get(normalized);
                if (cached) results.set(place, cached);
            } else {
                uncached.push(place);
            }
        }

        // If everything is cached, return immediately — no network needed
        if (uncached.length === 0) {
            if (progressCallback) progressCallback(places.length, places.length);
            return results;
        }

        // Report initial progress (cached items already done)
        const total = places.length;
        let completed = total - uncached.length;
        if (progressCallback) progressCallback(completed, total);

        // Geocode uncached places sequentially with rate limiting
        for (const place of uncached) {
            const result = await this.geocodePlace(place);
            if (result) results.set(place, result);
            completed++;
            if (progressCallback) progressCallback(completed, total);

            // Rate limit: 1.1 seconds between requests
            if (completed < total) {
                await new Promise(r => setTimeout(r, 1100));
            }
        }

        return results;
    }

    /**
     * Count how many of the given places still need geocoding (not in cache)
     */
    countUncached(places) {
        let count = 0;
        for (const place of places) {
            const normalized = this.normalizePlaceString(place);
            if (normalized && !this.cache.has(normalized)) count++;
        }
        return count;
    }

    /**
     * Extract all unique place strings (birthPlace/deathPlace) from persons
     * @param {Map|Array} persons - Map or array of Person objects
     * @returns {string[]} Deduplicated array of non-empty place strings
     */
    static extractUniquePlaces(persons) {
        const places = new Set();
        const iter = persons instanceof Map ? persons.values() : persons;
        for (const person of iter) {
            if (person.birthPlace) places.add(person.birthPlace);
            if (person.deathPlace) places.add(person.deathPlace);
        }
        return Array.from(places);
    }

    /**
     * Get cached result for a place string (or null if not cached or no result)
     */
    getCached(place) {
        const normalized = this.normalizePlaceString(place);
        if (!normalized) return null;
        const result = this.cache.get(normalized);
        return result || null;
    }

    /**
     * Check if a place is already in cache (even if result is null)
     */
    isCached(place) {
        const normalized = this.normalizePlaceString(place);
        return this.cache.has(normalized);
    }

    /**
     * Get the number of cached entries
     */
    get cacheSize() {
        return this.cache.size;
    }
}
