/**
 * MapView — 2D flat map visualization using Leaflet with OpenStreetMap tiles.
 * Shows birth/death points and life path lines for each person.
 * Points and lines scale down as you zoom in for precise location viewing.
 * Includes time slider to filter by birth date (25-year windows).
 */

class MapView {
    constructor(container, app) {
        this.container = container;
        this.app = app;

        this.map = null;
        this.geocodeResults = new Map();
        this.isReady = false;

        // Leaflet layer groups
        this.pointsLayer = null;
        this.lifeLinesLayer = null;

        // Computed data arrays
        this.pointsData = [];
        this.lifeLineData = [];

        // Toggle states
        this.showLifeLines = true;
        this.showUnknownLocations = true;

        // Highlight/selection state
        this.highlightedCountry = null;
        this.selectedPersonId = null;

        // Time filter: null means show all
        this.timeFilterStart = null;
        this.timeFilterEnd = null;

        this._init();
    }

    _init() {
        if (typeof L === 'undefined') {
            this.container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6c757d;font-size:1.1rem;">Leaflet library not loaded.</div>';
            return;
        }

        this.map = L.map(this.container, {
            center: [30, 0],
            zoom: 3,
            zoomControl: true,
            preferCanvas: true  // Canvas renderer for better performance with many markers
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(this.map);

        // Layer groups for points and lines
        this.lifeLinesLayer = L.layerGroup().addTo(this.map);
        this.pointsLayer = L.layerGroup().addTo(this.map);

        // Rescale markers/lines on zoom
        this.map.on('zoomend', () => this._updateScaling());

        // Click map background to deselect across all views
        this.map.on('click', () => {
            if (this.selectedPersonId) {
                this.app.clearSelectionAcrossViews();
                this.app.detailPanel.classList.remove('active');
            }
        });

        this.isReady = true;
    }

    /**
     * Update geocoding results and rebuild
     */
    setGeocodeResults(results) {
        this.geocodeResults = results;
        this.computeLayout();
        this.render();
    }

    /**
     * Select a person — highlights their data and dims everything else
     */
    selectPerson(personId) {
        if (this.selectedPersonId === personId) {
            this.selectedPersonId = null;
        } else {
            this.selectedPersonId = personId;
        }
        this.computeLayout();
        this.render();
    }

    clearSelection() {
        this.selectedPersonId = null;
        this.computeLayout();
        this.render();
    }

    /**
     * Set time filter range. null values mean no filter.
     */
    setTimeFilter(startYear, endYear) {
        this.timeFilterStart = startYear;
        this.timeFilterEnd = endYear;
        this.render();
    }

    /**
     * Build point and line data from persons + geocode results
     */
    computeLayout() {
        if (!this.isReady) return;

        this.pointsData = [];
        this.lifeLineData = [];

        const parser = this.app.parser;
        if (!parser || !parser.persons) return;

        const UNKNOWN = [0, 0];
        const selected = this.selectedPersonId;

        for (const person of parser.persons.values()) {
            const birthCoord = person.birthPlace ? this._getCoord(person.birthPlace) : null;
            const deathCoord = person.deathPlace ? this._getCoord(person.deathPlace) : null;
            const color = this._getPersonColor(person);
            const birthYear = this._extractYear(person.birthDate);

            const countryDimmed = this.highlightedCountry && person.country !== this.highlightedCountry;
            const selectionDimmed = selected && person.id !== selected;
            const dimmed = countryDimmed || selectionDimmed;
            const highlighted = selected && person.id === selected;

            const birthFinal = birthCoord ? [birthCoord.lat, birthCoord.lng] : UNKNOWN;
            const birthUnknown = !birthCoord;

            // Birth point — always created
            this.pointsData.push({
                latlng: birthFinal,
                baseRadius: highlighted ? 10 : (birthUnknown ? 5 : 6),
                color: dimmed ? '#b0b0b0' : (highlighted ? '#ffff00' : (birthUnknown ? '#ff6464' : color)),
                fillOpacity: dimmed ? 0.1 : (highlighted ? 1.0 : 0.8),
                strokeColor: dimmed ? '#b0b0b0' : (highlighted ? '#ff8800' : '#333'),
                strokeWeight: highlighted ? 2.5 : 1,
                strokeOpacity: dimmed ? 0.1 : (highlighted ? 1.0 : 0.5),
                label: `<b>${person.name || 'Unknown'}</b><br>Born: ${person.birthDate || '?'}<br>${person.birthPlace || '<i>Unknown location</i>'}`,
                personId: person.id,
                type: 'birth',
                isUnknownLocation: birthUnknown,
                birthYear: birthYear
            });

            // Death point
            if (deathCoord) {
                const sameLoc = birthCoord &&
                    Math.abs(birthCoord.lat - deathCoord.lat) < 0.01 &&
                    Math.abs(birthCoord.lng - deathCoord.lng) < 0.01;

                if (!sameLoc) {
                    this.pointsData.push({
                        latlng: [deathCoord.lat, deathCoord.lng],
                        baseRadius: highlighted ? 8 : 4,
                        color: dimmed ? '#b0b0b0' : (highlighted ? '#ffaa00' : color),
                        fillOpacity: dimmed ? 0.1 : (highlighted ? 1.0 : 0.7),
                        strokeColor: dimmed ? '#b0b0b0' : (highlighted ? '#ff6600' : '#333'),
                        strokeWeight: highlighted ? 2.5 : 1,
                        strokeOpacity: dimmed ? 0.1 : (highlighted ? 1.0 : 0.5),
                        label: `<b>${person.name || 'Unknown'}</b><br>Died: ${person.deathDate || '?'}<br>${person.deathPlace || ''}`,
                        personId: person.id,
                        type: 'death',
                        isUnknownLocation: false,
                        birthYear: birthYear
                    });
                }
            } else if (person.deathPlace) {
                this.pointsData.push({
                    latlng: UNKNOWN,
                    baseRadius: highlighted ? 8 : 4,
                    color: dimmed ? '#b0b0b0' : (highlighted ? '#ffaa00' : '#ff6464'),
                    fillOpacity: dimmed ? 0.1 : (highlighted ? 1.0 : 0.7),
                    strokeColor: dimmed ? '#b0b0b0' : (highlighted ? '#ff6600' : '#333'),
                    strokeWeight: highlighted ? 2.5 : 1,
                    strokeOpacity: dimmed ? 0.1 : (highlighted ? 1.0 : 0.5),
                    label: `<b>${person.name || 'Unknown'}</b><br>Died: ${person.deathDate || '?'}<br>${person.deathPlace}<br><em>Unknown location</em>`,
                    personId: person.id,
                    type: 'death',
                    isUnknownLocation: true,
                    birthYear: birthYear
                });
            }

            // Life line: birth → death (only real coords)
            if (birthCoord && deathCoord) {
                const sameLoc =
                    Math.abs(birthCoord.lat - deathCoord.lat) < 0.01 &&
                    Math.abs(birthCoord.lng - deathCoord.lng) < 0.01;

                if (!sameLoc) {
                    this.lifeLineData.push({
                        from: [birthCoord.lat, birthCoord.lng],
                        to: [deathCoord.lat, deathCoord.lng],
                        color: dimmed ? '#b0b0b0' : (highlighted ? '#ffdd00' : color),
                        baseWeight: highlighted ? 4 : 2,
                        opacity: dimmed ? 0.06 : (highlighted ? 0.9 : 0.5),
                        label: `<b>${person.name || 'Unknown'}</b><br>Life path`,
                        personId: person.id,
                        birthYear: birthYear
                    });
                }
            }
        }
    }

    /**
     * Check if a birth year passes the current time filter
     */
    _passesTimeFilter(birthYear) {
        if (this.timeFilterStart === null || this.timeFilterEnd === null) return true;
        if (birthYear === null) return false;
        return birthYear >= this.timeFilterStart && birthYear < this.timeFilterEnd;
    }

    /**
     * Render data into Leaflet layers
     */
    render() {
        if (!this.isReady || !this.map) return;

        const scaleFactor = this._getScaleFactor(this.map.getZoom());

        // Clear layers
        this.pointsLayer.clearLayers();
        this.lifeLinesLayer.clearLayers();

        // Life lines
        if (this.showLifeLines) {
            for (const line of this.lifeLineData) {
                if (!this._passesTimeFilter(line.birthYear)) continue;
                const polyline = L.polyline([line.from, line.to], {
                    color: line.color,
                    weight: line.baseWeight * scaleFactor,
                    opacity: line.opacity,
                    _baseWeight: line.baseWeight
                });
                polyline.bindTooltip(line.label);
                polyline.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    this.selectPerson(line.personId);
                    this.app.showPersonDetails(line.personId);
                });
                this.lifeLinesLayer.addLayer(polyline);
            }
        }

        // Points (drawn last, on top)
        let points = this.showUnknownLocations
            ? this.pointsData
            : this.pointsData.filter(p => !p.isUnknownLocation);

        for (const pt of points) {
            if (!this._passesTimeFilter(pt.birthYear)) continue;
            const marker = L.circleMarker(pt.latlng, {
                radius: pt.baseRadius * scaleFactor,
                fillColor: pt.color,
                fillOpacity: pt.fillOpacity,
                color: pt.strokeColor,
                weight: pt.strokeWeight,
                opacity: pt.strokeOpacity,
                _baseRadius: pt.baseRadius
            });
            marker.bindTooltip(pt.label);
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                this.selectPerson(pt.personId);
                this.app.showPersonDetails(pt.personId);
            });
            this.pointsLayer.addLayer(marker);
        }
    }

    /**
     * Scale factor: points and lines shrink as you zoom in
     */
    _getScaleFactor(zoom) {
        const base = 3;
        if (zoom <= base) return 1.0;
        return Math.max(0.15, 1.0 / (1 + (zoom - base) * 0.18));
    }

    /**
     * Update radii and weights in-place on zoom (avoids full re-render)
     */
    _updateScaling() {
        const scaleFactor = this._getScaleFactor(this.map.getZoom());

        this.pointsLayer.eachLayer((layer) => {
            if (layer.options._baseRadius) {
                layer.setRadius(layer.options._baseRadius * scaleFactor);
            }
        });

        this.lifeLinesLayer.eachLayer((layer) => {
            if (layer.options._baseWeight) {
                layer.setStyle({ weight: layer.options._baseWeight * scaleFactor });
            }
        });
    }

    resize() {
        if (!this.isReady || !this.map) return;
        this.map.invalidateSize();
    }

    centerOnRoot() {
        if (!this.isReady || !this.map) return;
        const rootId = this.app.rootPersonId;
        if (rootId) this.centerOnPerson(rootId);
    }

    centerOnPerson(personId) {
        if (!this.isReady || !this.map) return;
        const person = this.app.parser.persons.get(personId);
        if (!person) return;

        const coord = (person.birthPlace && this._getCoord(person.birthPlace)) ||
                      (person.deathPlace && this._getCoord(person.deathPlace));

        if (coord) {
            this.map.setView([coord.lat, coord.lng], 8, { animate: true });
        }
    }

    highlightCountry(country) {
        this.highlightedCountry = country;
        this.computeLayout();
        this.render();
    }

    setShowLifeLines(show) { this.showLifeLines = show; this.render(); }
    setShowUnknownLocations(show) { this.showUnknownLocations = show; this.render(); }

    _getCoord(place) {
        if (!place) return null;
        if (this.geocodeResults.has(place)) return this.geocodeResults.get(place);
        if (this.app.geocoder) return this.app.geocoder.getCached(place);
        return null;
    }

    _getPersonColor(person) {
        const color = this.app.getCountryColor(person.country);
        if (color) return color;
        const gen = person.generation || 0;
        const hue = (gen * 67) % 360;
        return `hsl(${hue}, 55%, 58%)`;
    }

    _extractYear(dateStr) {
        if (!dateStr) return null;
        const match = dateStr.match(/(\d{4})/);
        return match ? parseInt(match[1], 10) : null;
    }
}
