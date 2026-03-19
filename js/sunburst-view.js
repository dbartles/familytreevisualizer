/**
 * Sunburst View — D3.js zoomable sunburst for exploring large ancestor trees
 * Root person at center, ancestors radiate outward in concentric rings.
 * Click to zoom into a branch; click center to zoom back out.
 */

class SunburstView {
    constructor(container, app) {
        this.container = container;
        this.app = app;

        this.width = 0;
        this.height = 0;
        this.radius = 0;

        // D3 selections
        this.svg = null;
        this.g = null;
        this.arcGroup = null;
        this.labelGroup = null;

        // D3 data
        this.root = null;       // d3.hierarchy root
        this.currentZoom = null; // currently zoomed node

        // Arc generator
        this.arc = null;

        // Scales for zoom transitions
        this.xScale = null; // angle scale
        this.yScale = null; // radius scale

        // Highlight state
        this.highlightedCountry = null;

        // Zoom scale for +/- buttons
        this.zoomScale = 1;

        // Tooltip
        this.tooltip = null;

        // Breadcrumb
        this.breadcrumbTrail = [];

        this._init();
    }

    _init() {
        this.tooltip = document.getElementById('sunburst-tooltip');

        this.svg = d3.select(this.container).select('svg');
        if (this.svg.empty()) {
            this.svg = d3.select(this.container).append('svg');
        }

        this.g = this.svg.append('g');
        this.extensionGroup = this.g.append('g').attr('class', 'extensions').attr('pointer-events', 'none');
        this.arcGroup = this.g.append('g').attr('class', 'arcs');
        this.labelGroup = this.g.append('g').attr('class', 'labels').attr('pointer-events', 'none');
    }

    /**
     * Build a nested hierarchy object from the parser's Person/Family data.
     * The root person is the root; ancestors are children in the hierarchy.
     */
    _buildHierarchy() {
        const parser = this.app.parser;
        const rootId = this.app.rootPersonId;
        if (!rootId || !parser.persons.has(rootId)) return null;

        const visited = new Set();

        const buildNode = (personId) => {
            if (!personId || visited.has(personId)) return null;
            visited.add(personId);

            const person = parser.persons.get(personId);
            if (!person) return null;

            const node = {
                id: person.id,
                name: person.name || 'Unknown',
                sex: person.sex,
                birthDate: person.birthDate,
                deathDate: person.deathDate,
                country: person.country,
                generation: person.generation,
                children: []
            };

            // Add parents as children in the hierarchy (ancestors radiate outward)
            if (person.familyChildId) {
                const family = parser.families.get(person.familyChildId);
                if (family) {
                    if (family.husbandId && parser.persons.has(family.husbandId)) {
                        const father = buildNode(family.husbandId);
                        if (father) node.children.push(father);
                    }
                    if (family.wifeId && parser.persons.has(family.wifeId)) {
                        const mother = buildNode(family.wifeId);
                        if (mother) node.children.push(mother);
                    }
                }
            }

            return node;
        };

        return buildNode(rootId);
    }

    /**
     * Compute layout using d3.partition
     */
    computeLayout() {
        const hierarchyData = this._buildHierarchy();
        if (!hierarchyData) return;

        this.root = d3.hierarchy(hierarchyData);

        // Find max depth for equal partitioning
        let maxDepth = 0;
        this.root.each(d => { if (d.depth > maxDepth) maxDepth = d.depth; });
        this.maxDepth = maxDepth;

        // Equal partitioning: give each leaf enough value to fill
        // the angular space of all its potential (missing) descendants.
        // A leaf at depth d gets 2^(maxDepth - d) so it occupies the same
        // angular span as 2^(maxDepth-d) leaves at the deepest level.
        this.root.eachAfter(d => {
            if (!d.children || d.children.length === 0) {
                d.value = Math.pow(2, maxDepth - d.depth);
            } else {
                d.value = d.children.reduce((sum, c) => sum + c.value, 0);
            }
        });

        this.root.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
        d3.partition()(this.root);

        // Build extension arcs: for every leaf whose branch ends before maxDepth,
        // extend its color outward to the edge of the chart
        this.extensions = [];
        this.root.each(d => {
            if (d.children && d.children.length > 0) return; // not a leaf
            if (d.depth >= maxDepth) return; // already at max depth

            // Use country color, or fall back to the same generation-based color
            const country = d.data.country;
            let color = this.app.getCountryColor(country);
            if (!color) {
                const hue = ((d.depth || 0) * 67) % 360;
                color = `hsl(${hue}, 55%, 58%)`;
            }

            const band = d.y1 - d.y0;
            for (let k = 1; d.depth + k <= maxDepth; k++) {
                this.extensions.push({
                    x0: d.x0,
                    x1: d.x1,
                    y0: d.y0 + k * band,
                    y1: d.y0 + (k + 1) * band,
                    country: country,
                    color: color,
                    sourceNode: d
                });
            }
        });

        this.currentZoom = this.root;
        this.breadcrumbTrail = [this.root];
    }

    /**
     * Render the sunburst chart
     */
    render() {
        if (!this.root) return;

        this._updateDimensions();

        // Set up scales
        this.xScale = d3.scaleLinear()
            .domain([0, 1])
            .range([0, 2 * Math.PI])
            .clamp(true);

        this.yScale = d3.scaleSqrt()
            .domain([0, 1])
            .range([0, this.radius]);

        // Arc generator
        const xScale = this.xScale;
        const yScale = this.yScale;
        this.arc = d3.arc()
            .startAngle(d => Math.max(0, Math.min(2 * Math.PI, xScale(d.x0))))
            .endAngle(d => Math.max(0, Math.min(2 * Math.PI, xScale(d.x1))))
            .innerRadius(d => Math.max(0, yScale(d.y0)))
            .outerRadius(d => Math.max(0, yScale(d.y1)));

        // Size SVG
        this.svg
            .attr('width', this.width)
            .attr('height', this.height);

        this.zoomScale = 1;
        this.g.attr('transform', `translate(${this.width / 2},${this.height / 2})`);

        // DATA JOIN — extension arcs (behind main arcs)
        const extPaths = this.extensionGroup.selectAll('path')
            .data(this.extensions);

        extPaths.exit().remove();

        const enteringExt = extPaths.enter().append('path');
        enteringExt.merge(extPaths)
            .attr('d', d => this.arc(d))
            .attr('fill', d => d.color)
            .attr('fill-opacity', d => this._getExtensionOpacity(d))
            .attr('stroke', '#fff')
            .attr('stroke-width', 0.3)
            .attr('stroke-opacity', 0.3);

        // DATA JOIN — arcs
        const descendants = this.root.descendants();

        const paths = this.arcGroup.selectAll('path')
            .data(descendants, d => d.data.id);

        // EXIT
        paths.exit().remove();

        // ENTER + UPDATE
        const entering = paths.enter()
            .append('path');

        const allPaths = entering.merge(paths);

        allPaths
            .attr('d', d => this.arc(d))
            .attr('fill', d => this._getArcFill(d))
            .attr('fill-opacity', d => this._getArcOpacity(d))
            .attr('stroke', '#fff')
            .attr('stroke-width', 0.5)
            .attr('cursor', d => d.children ? 'pointer' : 'default')
            .on('click', (event, d) => {
                event.stopPropagation();
                if (d.depth === 0 && this.currentZoom === this.root) {
                    // Click on root when already at root — show details
                    this.app.showPersonDetails(d.data.id);
                } else if (d.depth === 0) {
                    // Click center circle — zoom out
                    this._zoomTo(this._getParentZoom());
                } else {
                    // Click any arc — zoom to it
                    this._zoomTo(d);
                    this.app.showPersonDetails(d.data.id);
                }
            })
            .on('mouseover', (event, d) => this._showTooltip(event, d))
            .on('mousemove', (event) => this._moveTooltip(event))
            .on('mouseout', () => this._hideTooltip());

        // Labels
        const labels = this.labelGroup.selectAll('text')
            .data(descendants, d => d.data.id);

        labels.exit().remove();

        const enteringLabels = labels.enter()
            .append('text');

        enteringLabels.merge(labels)
            .attr('transform', d => this._labelTransform(d))
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', d => this._labelFontSize(d))
            .attr('fill', d => this._labelColor(d))
            .attr('fill-opacity', d => this._labelVisible(d) ? 1 : 0)
            .text(d => this._labelText(d));

        // Render breadcrumb
        this._renderBreadcrumb();
    }

    _updateDimensions() {
        const rect = this.container.getBoundingClientRect();
        this.width = rect.width || 800;
        this.height = rect.height || 600;
        this.radius = Math.min(this.width, this.height) / 2;
    }

    _getArcFill(d) {
        if (d.depth === 0) return '#fff';
        const color = this.app.getCountryColor(d.data.country);
        if (color) return color;
        // Generation-based fallback color — vivid and distinct
        const hue = ((d.depth || 0) * 67) % 360;
        return `hsl(${hue}, 55%, 58%)`;
    }

    _getArcOpacity(d) {
        if (d.depth === 0) return 1;
        // Check ancestor visibility (only show descendants of current zoom)
        const isVisible = this._isAncestorOf(this.currentZoom, d);
        if (!isVisible) return 0;

        if (this.highlightedCountry) {
            return d.data.country === this.highlightedCountry ? 1.0 : 0.15;
        }
        return 1.0;
    }

    _getExtensionOpacity(d) {
        const isVisible = this._isAncestorOf(this.currentZoom, d.sourceNode);
        if (!isVisible) return 0;
        if (this.highlightedCountry) {
            return d.country === this.highlightedCountry ? 0.45 : 0.06;
        }
        return 0.45;
    }

    _isAncestorOf(ancestor, d) {
        if (ancestor === d) return true;
        let p = d.parent;
        while (p) {
            if (p === ancestor) return true;
            p = p.parent;
        }
        return false;
    }

    /**
     * Animated zoom to a target node
     */
    _zoomTo(target) {
        if (!target) return;

        this.currentZoom = target;

        // Update breadcrumb trail
        this.breadcrumbTrail = [];
        let node = target;
        while (node) {
            this.breadcrumbTrail.unshift(node);
            node = node.parent;
        }

        const transition = this.svg.transition()
            .duration(750)
            .tween('scale', () => {
                const xd = d3.interpolate(this.xScale.domain(), [target.x0, target.x1]);
                const yd = d3.interpolate(this.yScale.domain(), [target.y0, 1]);
                return t => {
                    this.xScale.domain(xd(t));
                    this.yScale.domain(yd(t));
                };
            });

        const arcGen = this.arc;
        const self = this;

        // Main arcs
        transition.selectAll('.arcs path')
            .attrTween('d', function(d) {
                return () => arcGen(d);
            })
            .attrTween('fill-opacity', function(d) {
                return () => self._getArcOpacity(d);
            });

        // Extension arcs
        transition.selectAll('.extensions path')
            .attrTween('d', function(d) {
                return () => arcGen(d);
            })
            .attrTween('fill-opacity', function(d) {
                return () => self._getExtensionOpacity(d);
            });

        transition.selectAll('.labels text')
            .attrTween('transform', function(d) {
                return () => self._labelTransform(d);
            })
            .attrTween('fill-opacity', function(d) {
                return () => self._labelVisible(d) ? 1 : 0;
            });

        transition.on('end', () => {
            this._renderBreadcrumb();
        });
    }

    _getParentZoom() {
        if (this.currentZoom && this.currentZoom.parent) {
            return this.currentZoom.parent;
        }
        return this.root;
    }

    /**
     * Highlight arcs matching a country; null to clear
     */
    highlightCountry(country) {
        this.highlightedCountry = country;

        this.arcGroup.selectAll('path')
            .transition()
            .duration(300)
            .attr('fill-opacity', d => this._getArcOpacity(d));

        this.extensionGroup.selectAll('path')
            .transition()
            .duration(300)
            .attr('fill-opacity', d => this._getExtensionOpacity(d));
    }

    /**
     * Center/zoom on a specific person by ID
     */
    centerOnPerson(personId) {
        if (!this.root) return;
        // Find the node in the hierarchy
        let target = null;
        this.root.each(d => {
            if (d.data.id === personId) target = d;
        });

        if (target) {
            // Zoom to parent so the target is visible as an arc
            const zoomTarget = target.parent || target;
            this._zoomTo(zoomTarget);
            this.app.showPersonDetails(personId);
        }
    }

    /**
     * Label helpers
     */
    _labelTransform(d) {
        const angle = (this.xScale((d.x0 + d.x1) / 2) - Math.PI / 2) * 180 / Math.PI;
        const radius = this.yScale((d.y0 + d.y1) / 2);
        return `rotate(${angle}) translate(${radius},0) rotate(${angle > 90 || angle < -90 ? 180 : 0})`;
    }

    _labelVisible(d) {
        if (d.depth === 0) return true;
        if (!this._isAncestorOf(this.currentZoom, d)) return false;
        const angleSpan = this.xScale(d.x1) - this.xScale(d.x0);
        const radialSpan = this.yScale(d.y1) - this.yScale(d.y0);
        return angleSpan > 0.06 && radialSpan > 14;
    }

    _labelFontSize(d) {
        if (d.depth === 0) return '12px';
        const radialSpan = this.yScale(d.y1) - this.yScale(d.y0);
        return Math.min(11, Math.max(7, radialSpan * 0.35)) + 'px';
    }

    _labelColor(d) {
        if (d.depth === 0) return '#212529';
        const fill = this._getArcFill(d);
        return this._getContrastColor(fill);
    }

    _labelText(d) {
        if (d.depth === 0) {
            const name = d.data.name || 'Unknown';
            return name.length > 18 ? name.substring(0, 16) + '..' : name;
        }
        const name = d.data.name || 'Unknown';
        const angleSpan = this.xScale(d.x1) - this.xScale(d.x0);
        const radius = this.yScale((d.y0 + d.y1) / 2);
        const arcLen = angleSpan * radius;
        const maxChars = Math.floor(arcLen / 6);
        if (maxChars < 3) return '';
        return name.length > maxChars ? name.substring(0, maxChars - 1) + '..' : name;
    }

    /**
     * Tooltip
     */
    _showTooltip(event, d) {
        if (!this.tooltip) return;
        const person = d.data;
        const birthYear = this._extractYear(person.birthDate);
        const deathYear = this._extractYear(person.deathDate);
        let dates = '';
        if (birthYear || deathYear) {
            dates = `${birthYear || '?'} – ${deathYear || ''}`;
        }

        this.tooltip.innerHTML = `
            <strong>${person.name || 'Unknown'}</strong>
            ${dates ? '<br>' + dates : ''}
            ${person.country ? '<br>' + person.country : ''}
            <br><em>Generation ${person.generation !== null ? person.generation : '?'}</em>
        `;
        this.tooltip.style.display = 'block';
        this._moveTooltip(event);
    }

    _moveTooltip(event) {
        if (!this.tooltip) return;
        this.tooltip.style.left = (event.pageX + 12) + 'px';
        this.tooltip.style.top = (event.pageY - 10) + 'px';
    }

    _hideTooltip() {
        if (!this.tooltip) return;
        this.tooltip.style.display = 'none';
    }

    /**
     * Breadcrumb trail
     */
    _renderBreadcrumb() {
        const bc = document.getElementById('sunburst-breadcrumb');
        if (!bc) return;
        bc.innerHTML = '';

        for (let i = 0; i < this.breadcrumbTrail.length; i++) {
            const node = this.breadcrumbTrail[i];
            const span = document.createElement('span');
            span.className = 'breadcrumb-item';
            span.textContent = node.data.name || 'Unknown';

            if (i < this.breadcrumbTrail.length - 1) {
                span.style.cursor = 'pointer';
                span.addEventListener('click', () => {
                    this._zoomTo(node);
                });
            } else {
                span.classList.add('breadcrumb-current');
            }

            bc.appendChild(span);

            if (i < this.breadcrumbTrail.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-sep';
                sep.textContent = ' › ';
                bc.appendChild(sep);
            }
        }
    }

    zoomIn() {
        this.zoomScale = Math.min(this.zoomScale * 1.3, 10);
        this.g.transition().duration(300)
            .attr('transform', `translate(${this.width / 2},${this.height / 2}) scale(${this.zoomScale})`);
    }

    zoomOut() {
        this.zoomScale = Math.max(this.zoomScale / 1.3, 0.3);
        this.g.transition().duration(300)
            .attr('transform', `translate(${this.width / 2},${this.height / 2}) scale(${this.zoomScale})`);
    }

    /**
     * Resize handler
     */
    resize() {
        if (!this.root) return;

        // If scales haven't been created yet (first render), just call render()
        if (!this.xScale || !this.yScale) {
            this.render();
            return;
        }

        this._updateDimensions();

        this.yScale.range([0, this.radius]);

        this.svg
            .attr('width', this.width)
            .attr('height', this.height);

        this.g.attr('transform', `translate(${this.width / 2},${this.height / 2})`);

        this.extensionGroup.selectAll('path').attr('d', d => this.arc(d));
        this.arcGroup.selectAll('path').attr('d', d => this.arc(d));

        this.labelGroup.selectAll('text')
            .attr('transform', d => this._labelTransform(d))
            .attr('fill-opacity', d => this._labelVisible(d) ? 1 : 0)
            .text(d => this._labelText(d));
    }

    /**
     * Utility
     */
    _extractYear(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})/);
        return match ? match[1] : '';
    }

    _getContrastColor(hex) {
        if (!hex || hex[0] !== '#') return '#000000';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.5 ? '#000000' : '#ffffff';
    }
}
