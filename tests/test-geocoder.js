/**
 * Unit tests for GeocodingService
 * Run with: node tests/test-geocoder.js
 */

// Minimal polyfills for Node.js environment
if (typeof localStorage === 'undefined') {
    const store = {};
    global.localStorage = {
        getItem: (k) => store[k] || null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
        key: (i) => Object.keys(store)[i] || null,
        get length() { return Object.keys(store).length; },
        clear: () => { for (const k in store) delete store[k]; }
    };
}

// Load the geocoder module
const fs = require('fs');
const path = require('path');
const geocoderSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'geocoder.js'), 'utf8');
const script = new (require('vm').Script)(geocoderSrc);
script.runInThisContext();

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message}`);
    }
}

function assertEqual(actual, expected, message) {
    if (actual === expected) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message} — expected "${expected}", got "${actual}"`);
    }
}

// ---- Tests ----

console.log('\n=== GeocodingService Tests ===\n');

// Test 1: normalizePlaceString
console.log('--- normalizePlaceString ---');
{
    const geo = new GeocodingService();

    assertEqual(geo.normalizePlaceString('  London, England  '), 'london, england',
        'trims and lowercases');

    assertEqual(geo.normalizePlaceString('Near Springfield, Illinois'), 'springfield, illinois',
        'strips "near" prefix');

    assertEqual(geo.normalizePlaceString('of Paris, France'), 'paris, france',
        'strips "of" prefix');

    assertEqual(geo.normalizePlaceString('About  Boston,  MA'), 'boston, ma',
        'strips "about" prefix and collapses spaces');

    assertEqual(geo.normalizePlaceString('probably Berlin, Germany'), 'berlin, germany',
        'strips "probably" prefix');

    assertEqual(geo.normalizePlaceString(''), '',
        'handles empty string');

    assertEqual(geo.normalizePlaceString(null), '',
        'handles null');

    assertEqual(geo.normalizePlaceString('New York (City), USA'), 'new york city, usa',
        'strips parentheses');
}

// Test 2: Cache hit/miss
console.log('\n--- Cache hit/miss ---');
{
    localStorage.clear();
    const geo = new GeocodingService();

    assert(!geo.isCached('London, England'), 'uncached place returns false');

    // Manually populate cache
    geo._saveToCache('london, england', { lat: 51.5, lng: -0.12 });
    assert(geo.isCached('London, England'), 'cached place returns true');

    const result = geo.getCached('London, England');
    assert(result !== null, 'getCached returns result for cached place');
    assertEqual(result.lat, 51.5, 'cached lat is correct');
    assertEqual(result.lng, -0.12, 'cached lng is correct');
}

// Test 3: Null caching (known failures)
console.log('\n--- Null caching ---');
{
    localStorage.clear();
    const geo = new GeocodingService();

    geo._saveToCache('nonexistent place xyz', null);
    assert(geo.isCached('Nonexistent Place XYZ'), 'null result is cached');

    const result = geo.getCached('Nonexistent Place XYZ');
    assert(result === null, 'getCached returns null for cached failure');
}

// Test 4: extractUniquePlaces
console.log('\n--- extractUniquePlaces ---');
{
    const persons = new Map();
    persons.set('I1', { birthPlace: 'London, England', deathPlace: 'Paris, France' });
    persons.set('I2', { birthPlace: 'London, England', deathPlace: null });
    persons.set('I3', { birthPlace: 'Berlin, Germany', deathPlace: 'Berlin, Germany' });
    persons.set('I4', { birthPlace: '', deathPlace: '' });
    persons.set('I5', { birthPlace: null, deathPlace: 'Rome, Italy' });

    const places = GeocodingService.extractUniquePlaces(persons);

    assertEqual(places.length, 4, 'extracts 4 unique places');
    assert(places.includes('London, England'), 'includes London');
    assert(places.includes('Paris, France'), 'includes Paris');
    assert(places.includes('Berlin, Germany'), 'includes Berlin');
    assert(places.includes('Rome, Italy'), 'includes Rome');
    assert(!places.includes(''), 'does not include empty string');
}

// Test 5: extractUniquePlaces with array
console.log('\n--- extractUniquePlaces (array input) ---');
{
    const persons = [
        { birthPlace: 'Vienna, Austria', deathPlace: 'Vienna, Austria' },
        { birthPlace: 'Prague, Czech Republic', deathPlace: null }
    ];

    const places = GeocodingService.extractUniquePlaces(persons);
    assertEqual(places.length, 2, 'extracts 2 unique places from array');
}

// Test 6: localStorage persistence
console.log('\n--- localStorage persistence ---');
{
    localStorage.clear();

    // First instance saves data
    const geo1 = new GeocodingService();
    geo1._saveToCache('test place', { lat: 40, lng: -74 });

    // Second instance should load from localStorage
    const geo2 = new GeocodingService();
    assert(geo2.isCached('Test Place'), 'new instance loads from localStorage');
    const result = geo2.getCached('Test Place');
    assertEqual(result.lat, 40, 'persisted lat is correct');
}

// Test 7: cacheSize
console.log('\n--- cacheSize ---');
{
    localStorage.clear();
    const geo = new GeocodingService();
    assertEqual(geo.cacheSize, 0, 'empty cache has size 0');

    geo._saveToCache('place1', { lat: 1, lng: 1 });
    geo._saveToCache('place2', null);
    assertEqual(geo.cacheSize, 2, 'cache size includes null entries');
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
