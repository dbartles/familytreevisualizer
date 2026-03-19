/**
 * Tree View — Canvas-based tree renderer with pan/zoom and virtual viewport
 */

class TreeView {
    constructor(canvas, app) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.app = app;

        // Layout mode: 'horizontal' (left-to-right) or 'vertical' (top-to-bottom)
        this.layoutMode = 'horizontal';

        // Node dimensions
        this.nodeWidth = 180;
        this.nodeHeight = 60;
        this.nodeHGap = 40;   // horizontal gap between generations
        this.nodeVGap = 16;   // vertical gap between siblings

        // Pan & zoom state
        this.offsetX = 50;
        this.offsetY = 50;
        this.scale = 1;
        this.minScale = 0.02;
        this.maxScale = 3;

        // Drag state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        // Layout cache: map personId -> { x, y, collapsed }
        this.layoutCache = new Map();
        this.collapsedNodes = new Set();

        // Hover / selected / highlight
        this.hoveredNode = null;
        this.selectedNode = null;
        this.highlightedCountry = null;

        // Tree bounds (computed after layout)
        this.treeBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };

        // Minimap
        this.minimapSize = 150;
        this.minimapPadding = 10;

        this._bindEvents();
    }

    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('click', (e) => this._onClick(e));
        this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));

        this._lastTouchDist = 0;
        this._lastTouchCenter = null;

        // Minimap drag state
        this._minimapDragging = false;
    }

    _onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.dragStartX = e.touches[0].clientX - this.offsetX;
            this.dragStartY = e.touches[0].clientY - this.offsetY;
        } else if (e.touches.length === 2) {
            this._lastTouchDist = this._getTouchDist(e);
            this._lastTouchCenter = this._getTouchCenter(e);
        }
    }

    _onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
            this.offsetX = e.touches[0].clientX - this.dragStartX;
            this.offsetY = e.touches[0].clientY - this.dragStartY;
            this.render();
        } else if (e.touches.length === 2) {
            const dist = this._getTouchDist(e);
            const center = this._getTouchCenter(e);
            if (this._lastTouchDist > 0) {
                const factor = dist / this._lastTouchDist;
                const rect = this.canvas.getBoundingClientRect();
                const cx = center.x - rect.left;
                const cy = center.y - rect.top;
                this._zoomAt(cx, cy, factor);
            }
            this._lastTouchDist = dist;
            this._lastTouchCenter = center;
        }
    }

    _onTouchEnd(e) {
        this.isDragging = false;
        this._lastTouchDist = 0;
    }

    _getTouchDist(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    _getTouchCenter(e) {
        return {
            x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
            y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };
    }

    _onMouseDown(e) {
        // Check if clicking minimap — start minimap drag
        if (this._isInMinimap(e)) {
            this._minimapDragging = true;
            this._handleMinimapDrag(e);
            return;
        }
        this.isDragging = true;
        this.dragStartX = e.clientX - this.offsetX;
        this.dragStartY = e.clientY - this.offsetY;
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
        if (this._minimapDragging) {
            this._handleMinimapDrag(e);
            return;
        }
        if (this.isDragging) {
            this.offsetX = e.clientX - this.dragStartX;
            this.offsetY = e.clientY - this.dragStartY;
            this.render();
            return;
        }

        // Hit-test for hover
        const pos = this._screenToWorld(e);
        const hit = this._hitTest(pos.x, pos.y);
        if (hit !== this.hoveredNode) {
            this.hoveredNode = hit;
            this.canvas.style.cursor = hit ? 'pointer' : 'grab';
            this.render();
        }
    }

    _onMouseUp(e) {
        this.isDragging = false;
        this._minimapDragging = false;
        this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    }

    _onWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this._zoomAt(cx, cy, factor);
    }

    _zoomAt(cx, cy, factor) {
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
        const ratio = newScale / this.scale;
        this.offsetX = cx - (cx - this.offsetX) * ratio;
        this.offsetY = cy - (cy - this.offsetY) * ratio;
        this.scale = newScale;
        this.render();
    }

    _onDblClick(e) {
        e.preventDefault();
        // Double-click to zoom into a location
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        this._zoomAt(cx, cy, 2.0);
    }

    _onClick(e) {
        const pos = this._screenToWorld(e);
        const hit = this._hitTest(pos.x, pos.y);

        if (hit) {
            // Check if clicking the collapse/expand button
            const layout = this.layoutCache.get(hit);
            if (layout) {
                const person = this.app.parser.persons.get(hit);
                if (person && person.familyChildId) {
                    const family = this.app.parser.families.get(person.familyChildId);
                    if (family && (family.husbandId || family.wifeId)) {
                        // Check if click is on the +/- button area
                        const btnX = this.layoutMode === 'horizontal'
                            ? layout.x + this.nodeWidth + 5
                            : layout.x + this.nodeWidth / 2 + 20;
                        const btnY = this.layoutMode === 'horizontal'
                            ? layout.y + this.nodeHeight / 2
                            : layout.y - 5;
                        const dx = pos.x - btnX;
                        const dy = pos.y - btnY;
                        if (dx * dx + dy * dy < 144) { // 12px radius
                            this.toggleCollapse(hit);
                            return;
                        }
                    }
                }
            }

            this.selectedNode = hit;
            this.app.showPersonDetails(hit);
            this.render();
        }
    }

    _screenToWorld(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.offsetX) / this.scale,
            y: (e.clientY - rect.top - this.offsetY) / this.scale
        };
    }

    _hitTest(wx, wy) {
        for (const [id, layout] of this.layoutCache) {
            if (wx >= layout.x && wx <= layout.x + this.nodeWidth &&
                wy >= layout.y && wy <= layout.y + this.nodeHeight) {
                return id;
            }
        }
        return null;
    }

    _isInMinimap(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const mmX = this.canvas.width - this.minimapSize - this.minimapPadding;
        const mmY = this.minimapPadding;
        return mx >= mmX && mx <= mmX + this.minimapSize &&
               my >= mmY && my <= mmY + this.minimapSize;
    }

    _handleMinimapDrag(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const mmX = this.canvas.width - this.minimapSize - this.minimapPadding;
        const mmY = this.minimapPadding;

        const bounds = this.treeBounds;
        const treeW = bounds.maxX - bounds.minX + this.nodeWidth;
        const treeH = bounds.maxY - bounds.minY + this.nodeHeight;
        const mmScale = Math.min(this.minimapSize / treeW, this.minimapSize / treeH) * 0.9;

        const relX = (mx - mmX) / (treeW * mmScale);
        const relY = (my - mmY) / (treeH * mmScale);

        this.offsetX = -((bounds.minX + relX * treeW) * this.scale - this.canvas.width / 2);
        this.offsetY = -((bounds.minY + relY * treeH) * this.scale - this.canvas.height / 2);
        this.render();
    }

    toggleCollapse(personId) {
        if (this.collapsedNodes.has(personId)) {
            this.collapsedNodes.delete(personId);
        } else {
            this.collapsedNodes.add(personId);
        }
        this.computeLayout();
        this.render();
    }

    setLayoutMode(mode) {
        this.layoutMode = mode;
        this.computeLayout();
        this.centerOnRoot();
        this.render();
    }

    /**
     * Compute tree layout positions for all visible nodes
     * Uses a recursive approach: ancestors of root person spread out
     */
    computeLayout() {
        this.layoutCache.clear();
        this._visited = new Set();
        const parser = this.app.parser;
        const rootId = this.app.rootPersonId;
        if (!rootId || !parser.persons.has(rootId)) return;

        // Build ancestor tree layout
        if (this.layoutMode === 'horizontal') {
            this._layoutHorizontal(rootId, 0, 0);
        } else {
            this._layoutVertical(rootId, 0, 0);
        }

        // Compute tree bounds
        this._computeBounds();
    }

    /**
     * Horizontal layout: root on left, ancestors extend right
     * Returns the { minY, maxY } of the subtree
     */
    _layoutHorizontal(personId, genX, hintY) {
        if (!personId || this._visited.has(personId)) {
            return { minY: hintY, maxY: hintY + this.nodeHeight };
        }
        this._visited.add(personId);

        const parser = this.app.parser;
        const person = parser.persons.get(personId);
        if (!person) return { minY: hintY, maxY: hintY + this.nodeHeight };

        const x = genX * (this.nodeWidth + this.nodeHGap);

        // If collapsed, just place this node
        if (this.collapsedNodes.has(personId)) {
            this.layoutCache.set(personId, { x, y: hintY, generation: genX });
            return { minY: hintY, maxY: hintY + this.nodeHeight };
        }

        // Get parents
        let fatherId = null, motherId = null;
        if (person.familyChildId) {
            const family = parser.families.get(person.familyChildId);
            if (family) {
                fatherId = family.husbandId;
                motherId = family.wifeId;
            }
        }

        const hasParents = fatherId || motherId;
        if (!hasParents) {
            this.layoutCache.set(personId, { x, y: hintY, generation: genX });
            return { minY: hintY, maxY: hintY + this.nodeHeight };
        }

        // Layout parents first (recursive)
        let currentY = hintY;
        let parentRanges = [];

        if (fatherId && parser.persons.has(fatherId)) {
            const range = this._layoutHorizontal(fatherId, genX + 1, currentY);
            parentRanges.push(range);
            currentY = range.maxY + this.nodeVGap;
        }

        if (motherId && parser.persons.has(motherId)) {
            const range = this._layoutHorizontal(motherId, genX + 1, currentY);
            parentRanges.push(range);
        }

        // Center this node between its parents
        if (parentRanges.length > 0) {
            const totalMin = parentRanges[0].minY;
            const totalMax = parentRanges[parentRanges.length - 1].maxY;
            const centerY = (totalMin + totalMax) / 2 - this.nodeHeight / 2;
            this.layoutCache.set(personId, { x, y: centerY, generation: genX });
            return { minY: totalMin, maxY: totalMax };
        } else {
            this.layoutCache.set(personId, { x, y: hintY, generation: genX });
            return { minY: hintY, maxY: hintY + this.nodeHeight };
        }
    }

    /**
     * Vertical layout: root on top, ancestors extend downward
     */
    _layoutVertical(personId, genY, hintX) {
        if (!personId || this._visited.has(personId)) {
            return { minX: hintX, maxX: hintX + this.nodeWidth };
        }
        this._visited.add(personId);

        const parser = this.app.parser;
        const person = parser.persons.get(personId);
        if (!person) return { minX: hintX, maxX: hintX + this.nodeWidth };

        const y = genY * (this.nodeHeight + this.nodeHGap);

        if (this.collapsedNodes.has(personId)) {
            this.layoutCache.set(personId, { x: hintX, y, generation: genY });
            return { minX: hintX, maxX: hintX + this.nodeWidth };
        }

        let fatherId = null, motherId = null;
        if (person.familyChildId) {
            const family = parser.families.get(person.familyChildId);
            if (family) {
                fatherId = family.husbandId;
                motherId = family.wifeId;
            }
        }

        const hasParents = fatherId || motherId;
        if (!hasParents) {
            this.layoutCache.set(personId, { x: hintX, y, generation: genY });
            return { minX: hintX, maxX: hintX + this.nodeWidth };
        }

        let currentX = hintX;
        let parentRanges = [];

        if (fatherId && parser.persons.has(fatherId)) {
            const range = this._layoutVertical(fatherId, genY + 1, currentX);
            parentRanges.push(range);
            currentX = range.maxX + this.nodeVGap;
        }

        if (motherId && parser.persons.has(motherId)) {
            const range = this._layoutVertical(motherId, genY + 1, currentX);
            parentRanges.push(range);
        }

        if (parentRanges.length > 0) {
            const totalMin = parentRanges[0].minX;
            const totalMax = parentRanges[parentRanges.length - 1].maxX;
            const centerX = (totalMin + totalMax) / 2 - this.nodeWidth / 2;
            this.layoutCache.set(personId, { x: centerX, y, generation: genY });
            return { minX: totalMin, maxX: totalMax };
        } else {
            this.layoutCache.set(personId, { x: hintX, y, generation: genY });
            return { minX: hintX, maxX: hintX + this.nodeWidth };
        }
    }

    _computeBounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const layout of this.layoutCache.values()) {
            if (layout.x < minX) minX = layout.x;
            if (layout.y < minY) minY = layout.y;
            if (layout.x + this.nodeWidth > maxX) maxX = layout.x + this.nodeWidth;
            if (layout.y + this.nodeHeight > maxY) maxY = layout.y + this.nodeHeight;
        }
        if (minX === Infinity) {
            this.treeBounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
        } else {
            this.treeBounds = { minX, minY, maxX, maxY };
        }
    }

    centerOnRoot() {
        const rootId = this.app.rootPersonId;
        if (!rootId) return;
        const layout = this.layoutCache.get(rootId);
        if (!layout) return;

        this.offsetX = this.canvas.width / 2 - (layout.x + this.nodeWidth / 2) * this.scale;
        this.offsetY = this.canvas.height / 2 - (layout.y + this.nodeHeight / 2) * this.scale;
    }

    centerOnPerson(personId) {
        const layout = this.layoutCache.get(personId);
        if (!layout) return;
        this.offsetX = this.canvas.width / 2 - (layout.x + this.nodeWidth / 2) * this.scale;
        this.offsetY = this.canvas.height / 2 - (layout.y + this.nodeHeight / 2) * this.scale;
        this.selectedNode = personId;
        this.render();
    }

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.render();
    }

    /**
     * Main render — draws only visible nodes for performance
     */
    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, w, h);

        if (this.layoutCache.size === 0) return;

        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);

        // Compute visible area in world coords
        const viewLeft = -this.offsetX / this.scale;
        const viewTop = -this.offsetY / this.scale;
        const viewRight = viewLeft + w / this.scale;
        const viewBottom = viewTop + h / this.scale;
        const margin = 100;

        const parser = this.app.parser;

        // Draw connection lines first
        ctx.strokeStyle = '#adb5bd';
        ctx.lineWidth = 1.5 / this.scale;
        for (const [id, layout] of this.layoutCache) {
            const person = parser.persons.get(id);
            if (!person || !person.familyChildId) continue;
            if (this.collapsedNodes.has(id)) continue;

            const family = parser.families.get(person.familyChildId);
            if (!family) continue;

            for (const parentId of [family.husbandId, family.wifeId]) {
                if (!parentId) continue;
                const parentLayout = this.layoutCache.get(parentId);
                if (!parentLayout) continue;

                if (this.layoutMode === 'horizontal') {
                    this._drawHorizontalConnector(ctx, layout, parentLayout);
                } else {
                    this._drawVerticalConnector(ctx, layout, parentLayout);
                }
            }
        }

        // Draw nodes (only visible ones)
        for (const [id, layout] of this.layoutCache) {
            // Virtual viewport culling
            if (layout.x + this.nodeWidth < viewLeft - margin ||
                layout.x > viewRight + margin ||
                layout.y + this.nodeHeight < viewTop - margin ||
                layout.y > viewBottom + margin) {
                continue;
            }

            const person = parser.persons.get(id);
            if (!person) continue;

            this._drawNode(ctx, id, person, layout);
        }

        ctx.restore();

        // Draw minimap
        this._drawMinimap(ctx, w, h);

        // Draw zoom level indicator
        ctx.fillStyle = '#6c757d';
        ctx.font = '12px monospace';
        ctx.fillText(`Zoom: ${(this.scale * 100).toFixed(0)}%  |  Nodes: ${this.layoutCache.size}`, 10, h - 10);
    }

    _drawHorizontalConnector(ctx, childLayout, parentLayout) {
        const x1 = childLayout.x + this.nodeWidth;
        const y1 = childLayout.y + this.nodeHeight / 2;
        const x2 = parentLayout.x;
        const y2 = parentLayout.y + this.nodeHeight / 2;
        const midX = (x1 + x2) / 2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(midX, y1, midX, y2, x2, y2);
        ctx.stroke();
    }

    _drawVerticalConnector(ctx, childLayout, parentLayout) {
        const x1 = childLayout.x + this.nodeWidth / 2;
        const y1 = childLayout.y + this.nodeHeight;
        const x2 = parentLayout.x + this.nodeWidth / 2;
        const y2 = parentLayout.y;
        const midY = (y1 + y2) / 2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
        ctx.stroke();
    }

    _drawNode(ctx, id, person, layout) {
        const x = layout.x;
        const y = layout.y;
        const w = this.nodeWidth;
        const h = this.nodeHeight;

        const isSelected = id === this.selectedNode;
        const isHovered = id === this.hoveredNode;

        // Country highlight dimming
        if (this.highlightedCountry && person.country !== this.highlightedCountry) {
            ctx.globalAlpha = 0.15;
        }

        // Country color
        const countryColor = this.app.getCountryColor(person.country);
        const genHue = ((layout.generation || 0) * 67) % 360;
        const defaultBorder = `hsl(${genHue}, 55%, 55%)`;

        // Node background
        ctx.fillStyle = isSelected ? '#e3f2fd' : isHovered ? '#f0f0f0' : '#ffffff';
        ctx.strokeStyle = isSelected ? '#1976d2' : countryColor || defaultBorder;
        ctx.lineWidth = isSelected ? 2 : 1;

        // Rounded rectangle
        const r = 6;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Country color indicator bar
        {
            ctx.fillStyle = countryColor || defaultBorder;
            ctx.beginPath();
            ctx.moveTo(x, y + r);
            ctx.lineTo(x, y + h - r);
            ctx.quadraticCurveTo(x, y + h, x + r, y + h);
            ctx.lineTo(x + r, y);
            ctx.quadraticCurveTo(x, y, x, y + r);
            ctx.closePath();
            ctx.fill();
        }

        // Sex indicator
        const sexIcon = person.sex === 'M' ? '\u2642' : person.sex === 'F' ? '\u2640' : '';
        if (sexIcon) {
            ctx.fillStyle = person.sex === 'M' ? '#1565c0' : '#c62828';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(sexIcon, x + w - 18, y + 16);
        }

        // Name
        ctx.fillStyle = '#212529';
        ctx.font = 'bold 11px sans-serif';
        const displayName = person.name || 'Unknown';
        const truncName = displayName.length > 22 ? displayName.substring(0, 20) + '...' : displayName;
        ctx.fillText(truncName, x + 10, y + 20);

        // Dates
        ctx.fillStyle = '#6c757d';
        ctx.font = '10px sans-serif';
        const birthYear = this._extractYear(person.birthDate);
        const deathYear = this._extractYear(person.deathDate);
        let dateStr = '';
        if (birthYear || deathYear) {
            dateStr = `${birthYear || '?'} - ${deathYear || ''}`;
        }
        if (dateStr) ctx.fillText(dateStr, x + 10, y + 35);

        // Country
        if (person.country) {
            ctx.fillStyle = '#868e96';
            ctx.font = '9px sans-serif';
            const truncCountry = person.country.length > 24 ? person.country.substring(0, 22) + '...' : person.country;
            ctx.fillText(truncCountry, x + 10, y + 50);
        }

        // Collapse/expand indicator
        const parser = this.app.parser;
        if (person.familyChildId) {
            const family = parser.families.get(person.familyChildId);
            if (family && (family.husbandId || family.wifeId)) {
                const isCollapsed = this.collapsedNodes.has(id);
                let btnX, btnY;
                if (this.layoutMode === 'horizontal') {
                    btnX = x + w + 5;
                    btnY = y + h / 2;
                } else {
                    btnX = x + w / 2 + 20;
                    btnY = y - 5;
                }
                ctx.fillStyle = '#6c757d';
                ctx.font = 'bold 12px sans-serif';
                ctx.beginPath();
                ctx.arc(btnX, btnY, 8, 0, Math.PI * 2);
                ctx.fillStyle = isCollapsed ? '#e9ecef' : '#dee2e6';
                ctx.fill();
                ctx.strokeStyle = '#6c757d';
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = '#495057';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isCollapsed ? '+' : '-', btnX, btnY);
                ctx.textAlign = 'start';
                ctx.textBaseline = 'alphabetic';
            }
        }

        // Restore alpha
        ctx.globalAlpha = 1.0;
    }

    _drawMinimap(ctx, canvasW, canvasH) {
        const mmSize = this.minimapSize;
        const pad = this.minimapPadding;
        const mmX = canvasW - mmSize - pad;
        const mmY = pad;

        const bounds = this.treeBounds;
        const treeW = bounds.maxX - bounds.minX;
        const treeH = bounds.maxY - bounds.minY;
        if (treeW <= 0 || treeH <= 0) return;

        const mmScale = Math.min(mmSize / treeW, mmSize / treeH) * 0.9;

        // Background
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = '#dee2e6';
        ctx.lineWidth = 1;
        ctx.fillRect(mmX, mmY, mmSize, mmSize);
        ctx.strokeRect(mmX, mmY, mmSize, mmSize);

        // Draw node dots
        ctx.fillStyle = '#6c757d';
        for (const layout of this.layoutCache.values()) {
            const dx = (layout.x - bounds.minX) * mmScale + mmX + 5;
            const dy = (layout.y - bounds.minY) * mmScale + mmY + 5;
            ctx.fillRect(dx, dy, 2, 2);
        }

        // Viewport rectangle
        const viewLeft = -this.offsetX / this.scale;
        const viewTop = -this.offsetY / this.scale;
        const viewW = canvasW / this.scale;
        const viewH = canvasH / this.scale;

        const vx = (viewLeft - bounds.minX) * mmScale + mmX + 5;
        const vy = (viewTop - bounds.minY) * mmScale + mmY + 5;
        const vw = viewW * mmScale;
        const vh = viewH * mmScale;

        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 2;
        ctx.strokeRect(vx, vy, vw, vh);
    }

    _extractYear(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})/);
        return match ? match[1] : '';
    }

    /**
     * Render the full tree to an off-screen canvas for export
     */
    renderForExport(width, height) {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = width;
        exportCanvas.height = height;
        const ctx = exportCanvas.getContext('2d');

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        const bounds = this.treeBounds;
        const treeW = bounds.maxX - bounds.minX;
        const treeH = bounds.maxY - bounds.minY;
        const padding = 50;

        const scaleX = (width - padding * 2) / treeW;
        const scaleY = (height - padding * 2) / treeH;
        const scale = Math.min(scaleX, scaleY);

        ctx.save();
        ctx.translate(padding - bounds.minX * scale, padding - bounds.minY * scale);
        ctx.scale(scale, scale);

        const parser = this.app.parser;

        // Draw connections
        ctx.strokeStyle = '#adb5bd';
        ctx.lineWidth = 1.5 / scale;
        for (const [id, layout] of this.layoutCache) {
            const person = parser.persons.get(id);
            if (!person || !person.familyChildId) continue;
            if (this.collapsedNodes.has(id)) continue;

            const family = parser.families.get(person.familyChildId);
            if (!family) continue;

            for (const parentId of [family.husbandId, family.wifeId]) {
                if (!parentId) continue;
                const parentLayout = this.layoutCache.get(parentId);
                if (!parentLayout) continue;

                if (this.layoutMode === 'horizontal') {
                    this._drawHorizontalConnector(ctx, layout, parentLayout);
                } else {
                    this._drawVerticalConnector(ctx, layout, parentLayout);
                }
            }
        }

        // Draw nodes
        for (const [id, layout] of this.layoutCache) {
            const person = parser.persons.get(id);
            if (!person) continue;
            this._drawNode(ctx, id, person, layout);
        }

        ctx.restore();
        return exportCanvas;
    }
}
