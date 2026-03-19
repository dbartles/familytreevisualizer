/**
 * GlobeView — Interactive 3D globe visualization using Globe.gl
 * Plots family tree members as dots on a globe with arcs for life paths
 * and ancestor connections.
 *
 * Uses OpenStreetMap tile rendering for progressive zoom detail.
 * Performance: merged point geometry, reduced arc resolution.
 */

class GlobeView {
    constructor(container, app) {
        this.container = container;
        this.app = app;

        this.globe = null;
        this.geocodeResults = new Map(); // place string → {lat, lng}
        this.isReady = false;

        // Data arrays for Globe.gl layers
        this.pointsData = [];
        this.lifeArcsData = [];
        this.ancestorArcsData = [];

        // Toggle states
        this.showLifeLines = true;
        this.showAncestorLines = true;
        this.showUnknownLocations = true;

        // Highlight state
        this.highlightedCountry = null;
        this.selectedPersonId = null;

        this._init();
    }

    _init() {
        // Check for WebGL support
        try {
            const testCanvas = document.createElement('canvas');
            const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
            if (!gl) {
                this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6c757d;font-size:1.1rem;">WebGL is not supported in this browser. The globe view requires WebGL.</div>';
                return;
            }
        } catch (e) {
            this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6c757d;font-size:1.1rem;">WebGL is not available.</div>';
            return;
        }

        // Initialize Globe.gl
        if (typeof Globe === 'undefined') {
            this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6c757d;font-size:1.1rem;">Globe.gl library not loaded.</div>';
            return;
        }

        const rect = this.container.getBoundingClientRect();
        this.globe = Globe()
            // Tile-based map for progressive zoom detail
            .globeImageUrl('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
            .bumpImageUrl('//unpkg.com/three-globe/example/img/earth-topology.png')
            .backgroundColor('#000011')
            .width(rect.width || 800)
            .height(rect.height || 600)
            // Points layer — merged for performance
            .pointsData([])
            .pointLat('lat')
            .pointLng('lng')
            .pointAltitude('alt')
            .pointRadius('radius')
            .pointColor('color')
            .pointLabel('label')
            .pointsMerge(true)
            .onPointClick((point) => {
                if (point && point.personId) {
                    this.selectPerson(point.personId);
                    this.app.showPersonDetails(point.personId);
                }
            })
            // Arcs layer — reduced resolution for performance
            .arcsData([])
            .arcStartLat('startLat')
            .arcStartLng('startLng')
            .arcEndLat('endLat')
            .arcEndLng('endLng')
            .arcColor('color')
            .arcAltitudeAutoScale(0.3)
            .arcStroke('stroke')
            .arcLabel('label')
            .arcCurveResolution(32)
            .arcCircularResolution(4)
            .onArcClick((arc) => {
                if (arc && arc.personId) {
                    this.selectPerson(arc.personId);
                    this.app.showPersonDetails(arc.personId);
                }
            })
            (this.container);

        // Set initial camera position
        this.globe.pointOfView({ lat: 30, lng: 0, altitude: 2.5 });

        this.isReady = true;
    }

    /**
     * Update geocoding results and rebuild data layers
     */
    setGeocodeResults(results) {
        this.geocodeResults = results;
        this.computeLayout();
        this.render();
    }

    /**
     * Select a person — highlights their points/arcs and dims everything else
     */
    selectPerson(personId) {
        if (this.selectedPersonId === personId) {
            // Clicking same person again deselects
            this.selectedPersonId = null;
        } else {
            this.selectedPersonId = personId;
        }
        this.computeLayout();
        this.render();
    }

    /**
     * Clear person selection
     */
    clearSelection() {
        this.selectedPersonId = null;
        this.computeLayout();
        this.render();
    }

    /**
     * Build point and arc data from persons + geocode results
     */
    computeLayout() {
        if (!this.isReady) return;

        this.pointsData = [];
        this.lifeArcsData = [];
        this.ancestorArcsData = [];

        const parser = this.app.parser;
        if (!parser || !parser.persons) return;

        const UNKNOWN = { lat: 0, lng: 0 };
        const selected = this.selectedPersonId;

        for (const person of parser.persons.values()) {
            const birthCoord = person.birthPlace ? this._getCoord(person.birthPlace) : null;
            const deathCoord = person.deathPlace ? this._getCoord(person.deathPlace) : null;
            const color = this._getPersonColor(person);

            // Dimming logic: country highlight OR person selection
            const countryDimmed = this.highlightedCountry && person.country !== this.highlightedCountry;
            const selectionDimmed = selected && person.id !== selected;
            const dimmed = countryDimmed || selectionDimmed;
            const highlighted = selected && person.id === selected;

            // Use real coords or fall back to 0,0 for unknown locations
            const birthFinal = birthCoord || UNKNOWN;
            const birthUnknown = !birthCoord;

            // Birth point — always created (every person gets at least one dot)
            this.pointsData.push({
                lat: birthFinal.lat,
                lng: birthFinal.lng,
                alt: highlighted ? 0.04 : 0.01,
                radius: highlighted ? 0.6 : (birthUnknown ? 0.25 : 0.35),
                color: dimmed ? 'rgba(80,80,80,0.12)' : (highlighted ? '#ffff00' : (birthUnknown ? 'rgba(255,100,100,0.7)' : color)),
                label: `<b>${person.name || 'Unknown'}</b><br>Born: ${person.birthDate || '?'}<br>${person.birthPlace || '<i>Unknown location</i>'}${birthUnknown ? '<br><em>Click to set location</em>' : ''}`,
                personId: person.id,
                type: 'birth',
                isUnknownLocation: birthUnknown,
                placeString: person.birthPlace || '',
                country: person.country
            });

            // Death point (smaller) — only if coords known and different from birth
            if (deathCoord) {
                const sameLoc = birthCoord &&
                    Math.abs(birthCoord.lat - deathCoord.lat) < 0.01 &&
                    Math.abs(birthCoord.lng - deathCoord.lng) < 0.01;

                if (!sameLoc) {
                    this.pointsData.push({
                        lat: deathCoord.lat,
                        lng: deathCoord.lng,
                        alt: highlighted ? 0.04 : 0.01,
                        radius: highlighted ? 0.5 : 0.2,
                        color: dimmed ? 'rgba(80,80,80,0.12)' : (highlighted ? '#ffaa00' : color),
                        label: `<b>${person.name || 'Unknown'}</b><br>Died: ${person.deathDate || '?'}<br>${person.deathPlace || ''}`,
                        personId: person.id,
                        type: 'death',
                        isUnknownLocation: false,
                        placeString: person.deathPlace || '',
                        country: person.country
                    });
                }
            } else if (person.deathPlace) {
                // Death place exists but failed geocoding — place at 0,0
                this.pointsData.push({
                    lat: 0,
                    lng: 0,
                    alt: highlighted ? 0.04 : 0.01,
                    radius: highlighted ? 0.5 : 0.18,
                    color: dimmed ? 'rgba(80,80,80,0.12)' : (highlighted ? '#ffff00' : 'rgba(255,100,100,0.7)'),
                    label: `<b>${person.name || 'Unknown'}</b><br>Died: ${person.deathDate || '?'}<br>${person.deathPlace}<br><em>Click to set location</em>`,
                    personId: person.id,
                    type: 'death',
                    isUnknownLocation: true,
                    placeString: person.deathPlace,
                    country: person.country
                });
            }

            // Life arc: birth → death (only when BOTH have real coordinates)
            if (birthCoord && deathCoord) {
                const sameLoc =
                    Math.abs(birthCoord.lat - deathCoord.lat) < 0.01 &&
                    Math.abs(birthCoord.lng - deathCoord.lng) < 0.01;

                if (!sameLoc) {
                    this.lifeArcsData.push({
                        startLat: birthCoord.lat,
                        startLng: birthCoord.lng,
                        endLat: deathCoord.lat,
                        endLng: deathCoord.lng,
                        color: dimmed ? 'rgba(80,80,80,0.06)' : (highlighted ? ['#ffff00', '#ffaa00'] : color),
                        stroke: highlighted ? 1.2 : 0.4,
                        label: `<b>${person.name || 'Unknown'}</b><br>Life path`,
                        personId: person.id,
                        type: 'life',
                        country: person.country
                    });
                }
            }

            // Ancestor arcs: child birth → parent birth (only real coords)
            if (birthCoord && person.familyChildId) {
                const family = parser.families.get(person.familyChildId);
                if (family) {
                    for (const parentId of [family.husbandId, family.wifeId]) {
                        if (!parentId) continue;
                        const parent = parser.persons.get(parentId);
                        if (!parent || !parent.birthPlace) continue;
                        const parentCoord = this._getCoord(parent.birthPlace);
                        if (!parentCoord) continue;

                        const sameLoc =
                            Math.abs(birthCoord.lat - parentCoord.lat) < 0.01 &&
                            Math.abs(birthCoord.lng - parentCoord.lng) < 0.01;
                        if (sameLoc) continue;

                        const gen = person.generation || 0;
                        const genHue = (gen * 67) % 360;
                        // Highlight ancestor arcs if either end is selected
                        const arcHighlighted = selected && (person.id === selected || parentId === selected);
                        const arcDimmed = (selected && !arcHighlighted) || countryDimmed;

                        this.ancestorArcsData.push({
                            startLat: birthCoord.lat,
                            startLng: birthCoord.lng,
                            endLat: parentCoord.lat,
                            endLng: parentCoord.lng,
                            color: arcDimmed ? 'rgba(80,80,80,0.04)' : (arcHighlighted ? ['#ffff00', '#ff6600'] : `hsla(${genHue}, 60%, 55%, 0.6)`),
                            stroke: arcHighlighted ? 1.0 : 0.3,
                            label: `<b>${person.name || 'Unknown'}</b> → <b>${parent.name || 'Unknown'}</b>`,
                            personId: person.id,
                            type: 'ancestor',
                            country: person.country
                        });
                    }
                }
            }
        }
    }

    /**
     * Render/update the globe with current data
     */
    render() {
        if (!this.isReady || !this.globe) return;

        // Filter points based on unknown-location toggle
        const points = this.showUnknownLocations
            ? this.pointsData
            : this.pointsData.filter(p => !p.isUnknownLocation);

        // Combine arc data based on toggle states
        const arcs = [];
        if (this.showLifeLines) arcs.push(...this.lifeArcsData);
        if (this.showAncestorLines) arcs.push(...this.ancestorArcsData);

        this.globe
            .pointsData(points)
            .arcsData(arcs);
    }

    /**
     * Resize the globe to fit its container
     */
    resize() {
        if (!this.isReady || !this.globe) return;
        const rect = this.container.getBoundingClientRect();
        this.globe.width(rect.width).height(rect.height);
    }

    /**
     * Center the globe on the root person's birth location
     */
    centerOnRoot() {
        if (!this.isReady || !this.globe) return;
        const rootId = this.app.rootPersonId;
        if (rootId) {
            this.centerOnPerson(rootId);
        }
    }

    /**
     * Animate the globe to center on a specific person
     */
    centerOnPerson(personId) {
        if (!this.isReady || !this.globe) return;
        const person = this.app.parser.persons.get(personId);
        if (!person) return;

        // Try birth place first, then death place
        const coord = (person.birthPlace && this._getCoord(person.birthPlace)) ||
                      (person.deathPlace && this._getCoord(person.deathPlace));

        if (coord) {
            this.globe.pointOfView({ lat: coord.lat, lng: coord.lng, altitude: 1.8 }, 1000);
        }
    }

    /**
     * Apply country highlight — rebuild data with dimming
     */
    highlightCountry(country) {
        this.highlightedCountry = country;
        this.computeLayout();
        this.render();
    }

    /**
     * Toggle life lines on/off
     */
    setShowLifeLines(show) {
        this.showLifeLines = show;
        this.render();
    }

    /**
     * Toggle ancestor lines on/off
     */
    setShowAncestorLines(show) {
        this.showAncestorLines = show;
        this.render();
    }

    /**
     * Toggle unknown-location (0,0) points on/off
     */
    setShowUnknownLocations(show) {
        this.showUnknownLocations = show;
        this.render();
    }

    /**
     * Get coordinates for a place string from geocode results
     */
    _getCoord(place) {
        if (!place) return null;
        // Try exact match first
        if (this.geocodeResults.has(place)) return this.geocodeResults.get(place);
        // Try via geocoder cache
        if (this.app.geocoder) {
            return this.app.geocoder.getCached(place);
        }
        return null;
    }

    /**
     * Get color for a person based on country
     */
    _getPersonColor(person) {
        const color = this.app.getCountryColor(person.country);
        if (color) return color;
        // Generation-based fallback
        const gen = person.generation || 0;
        const hue = (gen * 67) % 360;
        return `hsl(${hue}, 55%, 58%)`;
    }
}
