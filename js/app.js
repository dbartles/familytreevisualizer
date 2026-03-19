/**
 * App — Main controller: data loading, view switching, state management
 */

class App {
    constructor() {
        this.parser = new GEDCOMParser();
        this.treeView = null;
        this.fanView = null;
        this.sunburstView = null;
        this.globeView = null;
        this.mapView = null;
        this.geocoder = new GeocodingService();
        this.geocodingComplete = false;
        this.exportManager = new ExportManager(this);
        this.currentView = 'tree'; // 'tree', 'fan', 'sunburst', 'globe', or 'map'
        this.highlightedCountry = null;
        this.rootPersonId = null;
        this.selectedPersonId = null;
        this.isLoaded = false;

        // Country color palette
        this.countryColors = new Map();
        this.colorPalette = [
            '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
            '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
            '#86bcb6', '#8cd17d', '#b6992d', '#499894', '#e15759',
            '#f1ce63', '#d37295', '#a0cbe8', '#ffbe7d', '#8b8b8b',
            '#d4a6c8', '#fabfd2', '#d7b5a6', '#79706e', '#b07aa1',
            '#d4a6c8', '#93c5c1', '#aec7e8', '#ffbb78', '#98df8a'
        ];
        this.nextColorIndex = 0;

        this._init();
    }

    _init() {
        // DOM references
        this.welcomeScreen = document.getElementById('welcome-screen');
        this.mainContent = document.getElementById('main-content');
        this.treeCanvas = document.getElementById('tree-canvas');
        this.fanCanvas = document.getElementById('fan-canvas');
        this.detailPanel = document.getElementById('detail-panel');

        // File input
        const fileInput = document.getElementById('file-input');
        const dropZone = document.getElementById('drop-zone');
        const fileBtn = document.getElementById('file-btn');

        fileBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this._loadFile(e.target.files[0]);
        });

        // Drag and drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) {
                this._loadFile(e.dataTransfer.files[0]);
            }
        });

        // View toggle buttons
        document.getElementById('btn-tree-view').addEventListener('click', () => this.switchView('tree'));
        document.getElementById('btn-fan-view').addEventListener('click', () => this.switchView('fan'));
        document.getElementById('btn-sunburst-view').addEventListener('click', () => this.switchView('sunburst'));
        const globeBtn = document.getElementById('btn-globe-view');
        if (globeBtn) globeBtn.addEventListener('click', () => this.switchView('globe'));
        document.getElementById('btn-map-view').addEventListener('click', () => this.switchView('map'));

        // Map toggle controls
        document.getElementById('map-toggle-life-lines').addEventListener('change', (e) => {
            if (this.mapView) this.mapView.setShowLifeLines(e.target.checked);
        });
        document.getElementById('map-toggle-unknown-locations').addEventListener('change', (e) => {
            if (this.mapView) this.mapView.setShowUnknownLocations(e.target.checked);
        });

        // Map time slider
        this._timeSliderEnabled = false;
        this._timeSliderPlaying = false;
        this._timeSliderInterval = null;

        document.getElementById('time-slider').addEventListener('input', (e) => {
            this._onTimeSliderChange(parseInt(e.target.value, 10));
        });
        document.getElementById('btn-time-toggle').addEventListener('click', () => {
            this._toggleTimeSlider();
        });
        document.getElementById('btn-time-play').addEventListener('click', () => {
            this._toggleTimeSliderPlay();
        });

        // Globe toggle controls (globe disabled for performance, but safe to wire up)
        const toggleLifeLines = document.getElementById('toggle-life-lines');
        const toggleAncestorLines = document.getElementById('toggle-ancestor-lines');
        const toggleUnknownLoc = document.getElementById('toggle-unknown-locations');
        if (toggleLifeLines) toggleLifeLines.addEventListener('change', (e) => {
            if (this.globeView) this.globeView.setShowLifeLines(e.target.checked);
        });
        if (toggleAncestorLines) toggleAncestorLines.addEventListener('change', (e) => {
            if (this.globeView) this.globeView.setShowAncestorLines(e.target.checked);
        });
        if (toggleUnknownLoc) toggleUnknownLoc.addEventListener('change', (e) => {
            if (this.globeView) this.globeView.setShowUnknownLocations(e.target.checked);
        });

        // Layout toggle
        document.getElementById('btn-horizontal').addEventListener('click', () => {
            if (this.treeView) {
                document.getElementById('btn-horizontal').classList.add('active');
                document.getElementById('btn-vertical').classList.remove('active');
                this.treeView.setLayoutMode('horizontal');
            }
        });
        document.getElementById('btn-vertical').addEventListener('click', () => {
            if (this.treeView) {
                document.getElementById('btn-vertical').classList.add('active');
                document.getElementById('btn-horizontal').classList.remove('active');
                this.treeView.setLayoutMode('vertical');
            }
        });

        // Search
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim();
            if (query.length < 2) {
                searchResults.classList.remove('active');
                return;
            }
            const results = this.parser.searchPersons(query);
            this._showSearchResults(results);
        });

        // Close detail panel
        document.getElementById('detail-close').addEventListener('click', () => {
            this.detailPanel.classList.remove('active');
            this.clearSelectionAcrossViews();
        });

        // Export
        document.getElementById('btn-export').addEventListener('click', () => {
            this.exportManager.showDialog();
        });
        document.getElementById('export-cancel').addEventListener('click', () => {
            this.exportManager.hideDialog();
        });
        document.getElementById('export-execute').addEventListener('click', () => {
            const format = document.getElementById('export-format').value;
            const width = parseFloat(document.getElementById('export-width').value) || 36;
            const dpi = parseInt(document.getElementById('export-dpi').value) || 150;
            this.exportManager.doExport(format, width, dpi);
        });

        // Save location edit
        document.getElementById('btn-save-location').addEventListener('click', () => {
            this._saveLocationEdit();
        });

        // Save geocache
        document.getElementById('btn-save-geocache').addEventListener('click', () => {
            if (this.geocoder) {
                this.geocoder.downloadCacheFile();
                document.getElementById('btn-save-geocache').style.display = 'none';
            }
        });

        // Root person selector
        document.getElementById('btn-change-root').addEventListener('click', () => {
            const select = document.getElementById('root-person-select');
            select.classList.toggle('active');
        });

        // Fit view
        document.getElementById('btn-fit').addEventListener('click', () => this._fitView());

        // Zoom controls
        document.getElementById('btn-zoom-in').addEventListener('click', () => this._zoomIn());
        document.getElementById('btn-zoom-out').addEventListener('click', () => this._zoomOut());
        document.getElementById('btn-zoom-fit').addEventListener('click', () => this._fitView());

        // Pan controls
        document.getElementById('btn-pan-up').addEventListener('click', () => this._pan(0, 80));
        document.getElementById('btn-pan-down').addEventListener('click', () => this._pan(0, -80));
        document.getElementById('btn-pan-left').addEventListener('click', () => this._pan(80, 0));
        document.getElementById('btn-pan-right').addEventListener('click', () => this._pan(-80, 0));

        // Window resize
        window.addEventListener('resize', () => this._onResize());

        // Auto-load: check for data/tree.ged or ?file= param
        this._tryAutoLoad();
    }

    async _tryAutoLoad() {
        // Check URL param: ?file=path/to/file.ged
        const params = new URLSearchParams(window.location.search);
        const fileParam = params.get('file');
        const autoPath = fileParam || 'data/tree.ged';

        try {
            const resp = await fetch(autoPath);
            if (resp.ok) {
                const text = await resp.text();
                // Verify it looks like GEDCOM (starts with "0 HEAD")
                if (text.trimStart().startsWith('0 HEAD')) {
                    const statusEl = document.getElementById('load-status');
                    statusEl.textContent = 'Loading family tree...';
                    statusEl.style.display = 'block';
                    await this._loadText(text, autoPath.split('/').pop());
                }
            }
        } catch (e) {
            // No auto-load file available — show welcome screen as usual
        }
    }

    async _loadFile(file) {
        const statusEl = document.getElementById('load-status');
        statusEl.textContent = `Loading ${file.name}...`;
        statusEl.style.display = 'block';

        try {
            const text = await file.text();
            await this._loadText(text, file.name);
        } catch (err) {
            console.error('Load error:', err);
            const statusEl = document.getElementById('load-status');
            statusEl.textContent = 'Error: ' + err.message;
        }
    }

    async _loadText(text, fileName) {
        const statusEl = document.getElementById('load-status');
        statusEl.textContent = `Parsing ${fileName}...`;
        statusEl.style.display = 'block';

        try {
            // Parse in next frame to allow UI update
            await new Promise(r => setTimeout(r, 10));

            const result = this.parser.parse(text);
            this.rootPersonId = result.rootPersonId;

            statusEl.textContent = `Parsed ${result.persons.size} persons, ${result.families.size} families. Computing generations...`;
            await new Promise(r => setTimeout(r, 10));

            this.parser.computeGenerations(this.rootPersonId);

            const maxGen = this.parser.getMaxGeneration();
            statusEl.textContent = `${result.persons.size} persons, ${result.families.size} families, ${maxGen} generations. Initializing views...`;
            await new Promise(r => setTimeout(r, 10));

            // Build country color map
            this._buildCountryColors();

            // Populate root person selector
            this._populateRootSelector();

            // Switch to main view
            this.welcomeScreen.style.display = 'none';
            this.mainContent.style.display = 'flex';

            // Initialize views
            this._initViews();
            this._initTimeSlider();
            this.isLoaded = true;

            // Start geocoding in background (non-blocking)
            this._startGeocoding();

            // Update stats
            document.getElementById('stats-persons').textContent = result.persons.size;
            document.getElementById('stats-families').textContent = result.families.size;
            document.getElementById('stats-generations').textContent = maxGen;

            // Show country legend
            this._renderCountryLegend();

        } catch (err) {
            console.error('Load error:', err);
            statusEl.textContent = 'Error: ' + err.message;
        }
    }

    _initViews() {
        // Tree view
        this.treeCanvas.width = this.treeCanvas.parentElement.clientWidth;
        this.treeCanvas.height = this.treeCanvas.parentElement.clientHeight;
        this.treeView = new TreeView(this.treeCanvas, this);
        this.treeView.computeLayout();
        this.treeView.centerOnRoot();
        this.treeView.render();

        // Fan view
        this.fanCanvas.width = this.fanCanvas.parentElement.clientWidth;
        this.fanCanvas.height = this.fanCanvas.parentElement.clientHeight;
        this.fanView = new FanView(this.fanCanvas, this);
        this.fanView.computeLayout();
        this.fanView.centerOnRoot();

        // Sunburst view
        const sunburstContainer = document.getElementById('sunburst-container');
        this.sunburstView = new SunburstView(sunburstContainer, this);
        this.sunburstView.computeLayout();

        // Globe view — disabled for performance (uncomment to re-enable)
        // const globeContainer = document.getElementById('globe-container');
        // this.globeView = new GlobeView(globeContainer, this);

        // Map view
        const mapContainer = document.getElementById('map-container');
        this.mapView = new MapView(mapContainer, this);

        // Show tree view by default
        this.switchView('sunburst');
    }

    switchView(view) {
        // Stop time slider playback when leaving map
        if (this.currentView === 'map' && view !== 'map' && this._timeSliderPlaying) {
            this._stopTimeSliderPlay();
        }
        this.currentView = view;

        const treeContainer = document.getElementById('tree-container');
        const fanContainer = document.getElementById('fan-container');
        const sunburstContainer = document.getElementById('sunburst-container');
        const globeContainer = document.getElementById('globe-container');
        const mapContainer = document.getElementById('map-container');
        const layoutBtns = document.getElementById('layout-buttons');
        const breadcrumb = document.getElementById('sunburst-breadcrumb');
        const globeControls = document.getElementById('globe-controls');
        const mapControls = document.getElementById('map-controls');
        const mapTimeSlider = document.getElementById('map-time-slider');
        const zoomControls = document.getElementById('zoom-controls');

        document.getElementById('btn-tree-view').classList.toggle('active', view === 'tree');
        document.getElementById('btn-fan-view').classList.toggle('active', view === 'fan');
        document.getElementById('btn-sunburst-view').classList.toggle('active', view === 'sunburst');
        const globeViewBtn = document.getElementById('btn-globe-view');
        if (globeViewBtn) globeViewBtn.classList.toggle('active', view === 'globe');
        document.getElementById('btn-map-view').classList.toggle('active', view === 'map');

        treeContainer.style.display = view === 'tree' ? 'block' : 'none';
        fanContainer.style.display = view === 'fan' ? 'block' : 'none';
        sunburstContainer.style.display = view === 'sunburst' ? 'block' : 'none';
        globeContainer.style.display = view === 'globe' ? 'block' : 'none';
        mapContainer.style.display = view === 'map' ? 'block' : 'none';
        layoutBtns.style.display = view === 'tree' ? 'flex' : 'none';
        breadcrumb.style.display = view === 'sunburst' ? 'block' : 'none';
        globeControls.style.display = view === 'globe' ? 'block' : 'none';
        mapControls.style.display = view === 'map' ? 'block' : 'none';
        mapTimeSlider.style.display = view === 'map' ? 'block' : 'none';
        // Hide our zoom controls for map (Leaflet has its own) and show for others
        zoomControls.style.display = view === 'map' ? 'none' : 'flex';

        if (view === 'tree' && this.treeView) {
            this.treeView.resize();
            this.treeView.render();
        } else if (view === 'fan' && this.fanView) {
            this.fanView.resize();
            this.fanView.render();
        } else if (view === 'sunburst' && this.sunburstView) {
            this.sunburstView.resize();
            this.sunburstView.render();
        } else if (view === 'globe' && this.globeView) {
            this.globeView.resize();
            this.globeView.render();
        } else if (view === 'map' && this.mapView) {
            this.mapView.resize();
            this.mapView.render();
        }
    }

    /**
     * Select a person across all views — highlights them in whichever view is active
     * and pre-sets selection so switching views shows the same person selected.
     */
    selectPersonAcrossViews(personId) {
        this.selectedPersonId = personId;

        // Tree view
        if (this.treeView) {
            this.treeView.selectedNode = personId;
            if (this.currentView === 'tree') this.treeView.render();
        }

        // Fan view
        if (this.fanView) {
            this.fanView.selectedWedge = personId;
            if (this.currentView === 'fan') this.fanView.render();
        }

        // Sunburst — no persistent selection state, but center on person
        // (handled by _navigateToPerson when switching views)

        // Globe view
        if (this.globeView) {
            this.globeView.selectedPersonId = personId;
            this.globeView.computeLayout();
            if (this.currentView === 'globe') this.globeView.render();
        }

        // Map view
        if (this.mapView) {
            this.mapView.selectedPersonId = personId;
            this.mapView.computeLayout();
            if (this.currentView === 'map') this.mapView.render();
        }
    }

    clearSelectionAcrossViews() {
        this.selectedPersonId = null;

        if (this.treeView) {
            this.treeView.selectedNode = null;
            if (this.currentView === 'tree') this.treeView.render();
        }
        if (this.fanView) {
            this.fanView.selectedWedge = null;
            if (this.currentView === 'fan') this.fanView.render();
        }
        if (this.globeView) {
            this.globeView.clearSelection();
        }
        if (this.mapView) {
            this.mapView.clearSelection();
        }
    }

    showPersonDetails(personId) {
        const person = this.parser.persons.get(personId);
        if (!person) return;

        this.selectPersonAcrossViews(personId);
        this.detailPanel.dataset.personId = personId;

        document.getElementById('detail-name').textContent = person.name || 'Unknown';
        document.getElementById('detail-sex').textContent = person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : 'Unknown';
        document.getElementById('detail-birth-date').textContent = person.birthDate || 'Unknown';
        document.getElementById('detail-birth-place').textContent = person.birthPlace || 'Unknown';
        document.getElementById('detail-death-date').textContent = person.deathDate || '-';
        document.getElementById('detail-death-place').textContent = person.deathPlace || '-';
        document.getElementById('detail-generation').textContent = person.generation !== null ? person.generation : 'Unknown';
        document.getElementById('detail-country').textContent = person.country || 'Unknown';

        // Family info
        const familyInfo = document.getElementById('detail-family');
        familyInfo.innerHTML = '';

        // Parents
        if (person.familyChildId) {
            const family = this.parser.families.get(person.familyChildId);
            if (family) {
                if (family.husbandId) {
                    const father = this.parser.persons.get(family.husbandId);
                    if (father) {
                        const link = this._createPersonLink(father);
                        const div = document.createElement('div');
                        div.innerHTML = '<strong>Father:</strong> ';
                        div.appendChild(link);
                        familyInfo.appendChild(div);
                    }
                }
                if (family.wifeId) {
                    const mother = this.parser.persons.get(family.wifeId);
                    if (mother) {
                        const link = this._createPersonLink(mother);
                        const div = document.createElement('div');
                        div.innerHTML = '<strong>Mother:</strong> ';
                        div.appendChild(link);
                        familyInfo.appendChild(div);
                    }
                }
            }
        }

        // Spouses & children
        for (const famId of person.familySpouseIds) {
            const family = this.parser.families.get(famId);
            if (!family) continue;

            const spouseId = family.husbandId === personId ? family.wifeId : family.husbandId;
            if (spouseId) {
                const spouse = this.parser.persons.get(spouseId);
                if (spouse) {
                    const link = this._createPersonLink(spouse);
                    const div = document.createElement('div');
                    div.innerHTML = '<strong>Spouse:</strong> ';
                    div.appendChild(link);
                    familyInfo.appendChild(div);
                }
            }

            for (const childId of family.childIds) {
                const child = this.parser.persons.get(childId);
                if (child) {
                    const link = this._createPersonLink(child);
                    const div = document.createElement('div');
                    div.innerHTML = '<strong>Child:</strong> ';
                    div.appendChild(link);
                    familyInfo.appendChild(div);
                }
            }
        }

        // "Set as Root" button
        const setRootBtn = document.createElement('button');
        setRootBtn.className = 'btn btn-small';
        setRootBtn.textContent = 'Set as Root Person';
        setRootBtn.addEventListener('click', () => {
            this._changeRoot(personId);
        });
        const div = document.createElement('div');
        div.style.marginTop = '12px';
        div.appendChild(setRootBtn);
        familyInfo.appendChild(div);

        // Location edit section — visible in globe view
        const editSection = document.getElementById('detail-location-edit');
        const statusEl = document.getElementById('edit-location-status');
        statusEl.textContent = '';
        statusEl.style.color = '#4e79a7';

        if (this.currentView === 'globe' || this.currentView === 'map') {
            editSection.style.display = 'block';
            const placeTypeSelect = document.getElementById('edit-place-type');
            placeTypeSelect.value = 'birth';
            this._populateEditCoords(person, 'birth');
            placeTypeSelect.onchange = () => {
                this._populateEditCoords(person, placeTypeSelect.value);
                statusEl.textContent = '';
            };
        } else {
            editSection.style.display = 'none';
        }

        this.detailPanel.classList.add('active');
    }

    _populateEditCoords(person, placeType) {
        const place = placeType === 'birth' ? person.birthPlace : person.deathPlace;
        const coord = place ? this.geocoder.getCached(place) : null;
        document.getElementById('edit-lat').value = coord ? coord.lat : '';
        document.getElementById('edit-lng').value = coord ? coord.lng : '';
        document.getElementById('edit-place-name').textContent = place || '(no place recorded)';
    }

    _saveLocationEdit() {
        const personId = this.detailPanel.dataset.personId;
        const person = this.parser.persons.get(personId);
        const statusEl = document.getElementById('edit-location-status');
        if (!person) return;

        const placeType = document.getElementById('edit-place-type').value;
        const lat = parseFloat(document.getElementById('edit-lat').value);
        const lng = parseFloat(document.getElementById('edit-lng').value);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            statusEl.textContent = 'Invalid coordinates. Lat: -90 to 90, Lng: -180 to 180.';
            statusEl.style.color = '#e15759';
            return;
        }

        const place = placeType === 'birth' ? person.birthPlace : person.deathPlace;
        if (!place) {
            statusEl.textContent = 'No place name recorded in GEDCOM data for this field.';
            statusEl.style.color = '#e15759';
            return;
        }

        // Save correction into geocoder cache
        const coord = { lat, lng };
        const normalized = this.geocoder.normalizePlaceString(place);
        this.geocoder._saveToCache(normalized, coord);

        // Update globe
        if (this.globeView) {
            this.globeView.geocodeResults.set(place, coord);
            this.globeView.computeLayout();
            this.globeView.render();
        }

        // Update map
        if (this.mapView) {
            this.mapView.geocodeResults.set(place, coord);
            this.mapView.computeLayout();
            this.mapView.render();
        }

        // Show Save Geocache button
        document.getElementById('btn-save-geocache').style.display = 'inline-flex';

        statusEl.textContent = 'Saved. Click "Save Geocache" in toolbar to export.';
        statusEl.style.color = '#4e79a7';
    }

    _createPersonLink(person) {
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = person.name || 'Unknown';
        a.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPersonDetails(person.id);
            this._navigateToPerson(person.id);
        });
        return a;
    }

    _changeRoot(personId) {
        this.rootPersonId = personId;
        this.parser.computeGenerations(personId);

        if (this.treeView) {
            this.treeView.collapsedNodes.clear();
            this.treeView.computeLayout();
            this.treeView.centerOnRoot();
            this.treeView.render();
        }
        if (this.fanView) {
            this.fanView.computeLayout();
            this.fanView.centerOnRoot();
            if (this.currentView === 'fan') this.fanView.render();
        }
        if (this.sunburstView) {
            this.sunburstView.computeLayout();
            if (this.currentView === 'sunburst') this.sunburstView.render();
        }
        if (this.globeView) {
            this.globeView.computeLayout();
            if (this.currentView === 'globe') {
                this.globeView.render();
                this.globeView.centerOnRoot();
            }
        }
        if (this.mapView) {
            this.mapView.computeLayout();
            if (this.currentView === 'map') {
                this.mapView.render();
                this.mapView.centerOnRoot();
            }
        }

        // Update stats
        const maxGen = this.parser.getMaxGeneration();
        document.getElementById('stats-generations').textContent = maxGen;

        // Highlight in selector
        const select = document.getElementById('root-person-select');
        select.classList.remove('active');
    }

    _buildCountryColors() {
        this.countryColors.clear();
        this.nextColorIndex = 0;

        // Count countries and sort by frequency
        const countryCount = new Map();
        for (const person of this.parser.persons.values()) {
            if (person.country) {
                countryCount.set(person.country, (countryCount.get(person.country) || 0) + 1);
            }
        }

        // Sort by frequency (most common first)
        const sorted = Array.from(countryCount.entries()).sort((a, b) => b[1] - a[1]);

        for (const [country] of sorted) {
            if (this.nextColorIndex < this.colorPalette.length) {
                this.countryColors.set(country, this.colorPalette[this.nextColorIndex++]);
            } else {
                // Generate random muted color
                const hue = Math.random() * 360;
                this.countryColors.set(country, `hsl(${hue}, 40%, 60%)`);
            }
        }
    }

    getCountryColor(country) {
        if (!country) return null;
        return this.countryColors.get(country) || null;
    }

    _renderCountryLegend() {
        const legend = document.getElementById('country-legend');
        legend.innerHTML = '';

        for (const [country, color] of this.countryColors) {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.dataset.country = country;

            const swatch = document.createElement('span');
            swatch.className = 'legend-swatch';
            swatch.style.backgroundColor = color;

            const label = document.createElement('span');
            label.className = 'legend-label';
            label.textContent = country;

            item.appendChild(swatch);
            item.appendChild(label);

            item.addEventListener('click', () => {
                this._toggleCountryHighlight(country);
            });

            legend.appendChild(item);
        }
    }

    _toggleCountryHighlight(country) {
        if (this.highlightedCountry === country) {
            // Clear highlight
            this.highlightedCountry = null;
        } else {
            this.highlightedCountry = country;
        }

        // Update legend visual state
        const items = document.querySelectorAll('.legend-item');
        for (const item of items) {
            const c = item.dataset.country;
            item.classList.toggle('legend-active', c === this.highlightedCountry);
            item.classList.toggle('legend-dimmed',
                this.highlightedCountry !== null && c !== this.highlightedCountry);
        }

        // Apply highlight across all views
        if (this.sunburstView) {
            this.sunburstView.highlightCountry(this.highlightedCountry);
        }

        // Re-render canvas views (tree/fan/globe) to apply highlight
        if (this.currentView === 'tree' && this.treeView) {
            this.treeView.highlightedCountry = this.highlightedCountry;
            this.treeView.render();
        } else if (this.currentView === 'fan' && this.fanView) {
            this.fanView.highlightedCountry = this.highlightedCountry;
            this.fanView.render();
        } else if (this.currentView === 'globe' && this.globeView) {
            this.globeView.highlightCountry(this.highlightedCountry);
        } else if (this.currentView === 'map' && this.mapView) {
            this.mapView.highlightCountry(this.highlightedCountry);
        }
    }

    _navigateToPerson(personId) {
        if (this.currentView === 'tree' && this.treeView) {
            this.treeView.centerOnPerson(personId);
        } else if (this.currentView === 'fan' && this.fanView) {
            this.fanView.selectedWedge = personId;
            this.fanView.render();
        } else if (this.currentView === 'sunburst' && this.sunburstView) {
            this.sunburstView.centerOnPerson(personId);
        } else if (this.currentView === 'globe' && this.globeView) {
            this.globeView.selectedPersonId = personId;
            this.globeView.computeLayout();
            this.globeView.render();
            this.globeView.centerOnPerson(personId);
        } else if (this.currentView === 'map' && this.mapView) {
            this.mapView.selectPerson(personId);
            this.mapView.centerOnPerson(personId);
        }
    }

    _zoomIn() {
        if (this.currentView === 'tree' && this.treeView) {
            const cx = this.treeCanvas.width / 2;
            const cy = this.treeCanvas.height / 2;
            this.treeView._zoomAt(cx, cy, 1.3);
        } else if (this.currentView === 'fan' && this.fanView) {
            const cx = this.fanCanvas.width / 2;
            const cy = this.fanCanvas.height / 2;
            this.fanView._zoomAt(cx, cy, 1.3);
        } else if (this.currentView === 'sunburst' && this.sunburstView) {
            this.sunburstView.zoomIn();
        } else if (this.currentView === 'globe' && this.globeView && this.globeView.globe) {
            const pov = this.globeView.globe.pointOfView();
            this.globeView.globe.pointOfView({ altitude: pov.altitude * 0.7 }, 300);
        } else if (this.currentView === 'map' && this.mapView && this.mapView.map) {
            this.mapView.map.zoomIn();
        }
    }

    _zoomOut() {
        if (this.currentView === 'tree' && this.treeView) {
            const cx = this.treeCanvas.width / 2;
            const cy = this.treeCanvas.height / 2;
            this.treeView._zoomAt(cx, cy, 0.7);
        } else if (this.currentView === 'fan' && this.fanView) {
            const cx = this.fanCanvas.width / 2;
            const cy = this.fanCanvas.height / 2;
            this.fanView._zoomAt(cx, cy, 0.7);
        } else if (this.currentView === 'sunburst' && this.sunburstView) {
            this.sunburstView.zoomOut();
        } else if (this.currentView === 'globe' && this.globeView && this.globeView.globe) {
            const pov = this.globeView.globe.pointOfView();
            this.globeView.globe.pointOfView({ altitude: pov.altitude * 1.4 }, 300);
        } else if (this.currentView === 'map' && this.mapView && this.mapView.map) {
            this.mapView.map.zoomOut();
        }
    }

    _pan(dx, dy) {
        if (this.currentView === 'tree' && this.treeView) {
            this.treeView.offsetX += dx;
            this.treeView.offsetY += dy;
            this.treeView.render();
        } else if (this.currentView === 'fan' && this.fanView) {
            this.fanView.offsetX += dx;
            this.fanView.offsetY += dy;
            this.fanView.render();
        }
    }

    _fitView() {
        if (this.currentView === 'tree' && this.treeView) {
            this.treeView.centerOnRoot();
            this.treeView.scale = 1;
            this.treeView.render();
        } else if (this.currentView === 'fan' && this.fanView) {
            this.fanView.centerOnRoot();
            this.fanView.render();
        } else if (this.currentView === 'sunburst' && this.sunburstView) {
            this.sunburstView._zoomTo(this.sunburstView.root);
        } else if (this.currentView === 'globe' && this.globeView) {
            this.globeView.centerOnRoot();
        } else if (this.currentView === 'map' && this.mapView) {
            this.mapView.centerOnRoot();
        }
    }

    _populateRootSelector() {
        const container = document.getElementById('root-person-list');
        container.innerHTML = '';

        const persons = this.parser.getPersonsArray()
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        for (const person of persons) {
            const item = document.createElement('div');
            item.className = 'root-person-item';
            item.textContent = `${person.name || 'Unknown'} (${this._extractYear(person.birthDate) || '?'})`;
            item.addEventListener('click', () => {
                this._changeRoot(person.id);
            });
            container.appendChild(item);
        }
    }

    _showSearchResults(results) {
        const container = document.getElementById('search-results');
        container.innerHTML = '';

        if (results.length === 0) {
            container.classList.remove('active');
            return;
        }

        const shown = results.slice(0, 20);
        for (const person of shown) {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.textContent = `${person.name || 'Unknown'} (${this._extractYear(person.birthDate) || '?'})`;
            item.addEventListener('click', () => {
                this.showPersonDetails(person.id);
                this._navigateToPerson(person.id);
                container.classList.remove('active');
                document.getElementById('search-input').value = '';
            });
            container.appendChild(item);
        }

        if (results.length > 20) {
            const more = document.createElement('div');
            more.className = 'search-result-item search-result-more';
            more.textContent = `... and ${results.length - 20} more`;
            container.appendChild(more);
        }

        container.classList.add('active');
    }

    _extractYear(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})/);
        return match ? match[1] : '';
    }

    _onResize() {
        if (this.currentView === 'tree' && this.treeView) {
            this.treeView.resize();
        } else if (this.currentView === 'fan' && this.fanView) {
            this.fanView.resize();
        } else if (this.currentView === 'sunburst' && this.sunburstView) {
            this.sunburstView.resize();
        } else if (this.currentView === 'globe' && this.globeView) {
            this.globeView.resize();
        } else if (this.currentView === 'map' && this.mapView) {
            this.mapView.resize();
        }
    }

    /**
     * Start geocoding all unique places in the background
     */
    async _startGeocoding() {
        // Load pre-built geocache file first (shared with all visitors)
        await this.geocoder.loadFromFile('data/geocache.json');

        const places = GeocodingService.extractUniquePlaces(this.parser.persons);
        if (places.length === 0) {
            this.geocodingComplete = true;
            return;
        }

        const uncachedCount = this.geocoder.countUncached(places);
        console.log(`Geocoding: ${places.length} unique places, ${uncachedCount} need geocoding, ${places.length - uncachedCount} cached`);

        const progressEl = document.getElementById('geocoding-progress');
        const fillEl = document.getElementById('geocoding-fill');
        const countEl = document.getElementById('geocoding-count');

        if (uncachedCount === 0) {
            console.log('All places already cached — skipping geocoding');
        }

        // Only show progress bar if there are places to actually geocode
        if (uncachedCount > 0) {
            progressEl.classList.add('active');
        }

        try {
            const results = await this.geocoder.batchGeocode(places, (completed, total) => {
                const pct = total > 0 ? (completed / total * 100) : 0;
                fillEl.style.width = pct + '%';
                countEl.textContent = `${completed} / ${total}`;
            });

            this.geocodingComplete = true;
            progressEl.classList.remove('active');

            // Show "Save Geocache" button if new places were geocoded
            if (this.geocoder.hasNewEntries) {
                document.getElementById('btn-save-geocache').style.display = 'inline-flex';
            }

            // Update globe view with results
            if (this.globeView) {
                this.globeView.setGeocodeResults(results);
                if (this.currentView === 'globe') {
                    this.globeView.centerOnRoot();
                }
            }

            // Update map view with results
            if (this.mapView) {
                this.mapView.setGeocodeResults(results);
                if (this.currentView === 'map') {
                    this.mapView.centerOnRoot();
                }
            }
        } catch (err) {
            console.error('Geocoding error:', err);
            progressEl.classList.remove('active');
        }
    }

    /**
     * Initialize the time slider based on birth year range in the data
     */
    _initTimeSlider() {
        let minYear = Infinity, maxYear = -Infinity;
        for (const person of this.parser.persons.values()) {
            if (person.birthDate) {
                const m = person.birthDate.match(/(\d{4})/);
                if (m) {
                    const y = parseInt(m[1], 10);
                    if (y < minYear) minYear = y;
                    if (y > maxYear) maxYear = y;
                }
            }
        }

        if (minYear === Infinity || maxYear === -Infinity) return;

        // Round to 25-year boundaries
        this._timeSliderMinYear = Math.floor(minYear / 25) * 25;
        this._timeSliderMaxYear = Math.ceil((maxYear + 1) / 25) * 25;
        const steps = (this._timeSliderMaxYear - this._timeSliderMinYear) / 25;

        const slider = document.getElementById('time-slider');
        slider.min = 0;
        slider.max = steps;  // 0 = "all", 1..steps = each 25-year window
        slider.value = 0;

        // Build tick labels
        const ticksEl = document.getElementById('time-slider-ticks');
        ticksEl.innerHTML = '';
        const allTick = document.createElement('span');
        allTick.textContent = 'All';
        ticksEl.appendChild(allTick);
        for (let i = 1; i <= steps; i++) {
            const year = this._timeSliderMinYear + (i - 1) * 25;
            // Show every other tick to avoid crowding
            if (steps <= 10 || i % 2 === 1 || i === steps) {
                const tick = document.createElement('span');
                tick.textContent = year;
                ticksEl.appendChild(tick);
            }
        }

        document.getElementById('time-slider-label').textContent = 'All time periods';
    }

    _onTimeSliderChange(value) {
        const label = document.getElementById('time-slider-label');

        if (value === 0) {
            label.textContent = 'All time periods';
            if (this.mapView) this.mapView.setTimeFilter(null, null);
        } else {
            const startYear = this._timeSliderMinYear + (value - 1) * 25;
            const endYear = startYear + 25;
            label.textContent = `${startYear} – ${endYear}`;
            if (this.mapView) this.mapView.setTimeFilter(startYear, endYear);
        }
    }

    _toggleTimeSlider() {
        const slider = document.getElementById('time-slider');
        const toggleBtn = document.getElementById('btn-time-toggle');
        const playBtn = document.getElementById('btn-time-play');
        const panel = document.getElementById('map-time-slider');

        this._timeSliderEnabled = !this._timeSliderEnabled;

        if (this._timeSliderEnabled) {
            slider.disabled = false;
            toggleBtn.textContent = 'Disable';
            playBtn.disabled = false;
            panel.classList.remove('inactive');
            // Start at first period
            slider.value = 1;
            this._onTimeSliderChange(1);
        } else {
            // Stop playback if running
            this._stopTimeSliderPlay();
            slider.disabled = true;
            slider.value = 0;
            toggleBtn.textContent = 'Enable';
            playBtn.disabled = true;
            panel.classList.add('inactive');
            this._onTimeSliderChange(0);
        }
    }

    _toggleTimeSliderPlay() {
        if (this._timeSliderPlaying) {
            this._stopTimeSliderPlay();
        } else {
            this._startTimeSliderPlay();
        }
    }

    _startTimeSliderPlay() {
        const slider = document.getElementById('time-slider');
        const playBtn = document.getElementById('btn-time-play');
        const max = parseInt(slider.max, 10);

        this._timeSliderPlaying = true;
        playBtn.textContent = 'Stop';
        playBtn.classList.add('active');

        // If at end or at 0, start from beginning
        if (parseInt(slider.value, 10) >= max || parseInt(slider.value, 10) === 0) {
            slider.value = 1;
            this._onTimeSliderChange(1);
        }

        this._timeSliderInterval = setInterval(() => {
            let val = parseInt(slider.value, 10) + 1;
            if (val > max) {
                this._stopTimeSliderPlay();
                return;
            }
            slider.value = val;
            this._onTimeSliderChange(val);
        }, 1000);
    }

    _stopTimeSliderPlay() {
        const playBtn = document.getElementById('btn-time-play');
        this._timeSliderPlaying = false;
        playBtn.textContent = 'Play';
        playBtn.classList.remove('active');
        if (this._timeSliderInterval) {
            clearInterval(this._timeSliderInterval);
            this._timeSliderInterval = null;
        }
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
