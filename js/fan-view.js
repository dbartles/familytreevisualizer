/**
 * Fan View — Half-circle/fan chart renderer (Canvas-based)
 * Root person at center, ancestors radiate outward in concentric half-rings
 */

class FanView {
    constructor(canvas, app) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.app = app;

        // Pan & zoom
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 5;

        // Drag state
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        // Fan geometry
        this.centerX = 0;
        this.centerY = 0;
        this.innerRadius = 50;
        this.ringWidth = 40;     // Initial ring width, shrinks with generations
        this.startAngle = -Math.PI;  // Start at left (half circle opens right)
        this.endAngle = 0;

        // Layout cache: personId -> { generation, startAngle, endAngle, ring }
        this.fanLayout = new Map();
        this.maxGeneration = 0;

        // Hover / selected / highlight
        this.hoveredWedge = null;
        this.selectedWedge = null;
        this.highlightedCountry = null;

        this._bindEvents();
    }

    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this.canvas.addEventListener('mouseup', () => this._onMouseUp());
        this.canvas.addEventListener('mouseleave', () => this._onMouseUp());
        this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
        this.canvas.addEventListener('click', (e) => this._onClick(e));
        this.canvas.addEventListener('dblclick', (e) => this._onDblClick(e));

        // Touch support
        this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', () => this._onTouchEnd());
        this._lastTouchDist = 0;
    }

    _onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 1) {
            this.isDragging = true;
            this.dragStartX = e.touches[0].clientX - this.offsetX;
            this.dragStartY = e.touches[0].clientY - this.offsetY;
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this._lastTouchDist = Math.sqrt(dx * dx + dy * dy);
        }
    }

    _onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 1 && this.isDragging) {
            this.offsetX = e.touches[0].clientX - this.dragStartX;
            this.offsetY = e.touches[0].clientY - this.dragStartY;
            this.render();
        } else if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (this._lastTouchDist > 0) {
                const factor = dist / this._lastTouchDist;
                const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                const rect = this.canvas.getBoundingClientRect();
                this._zoomAt(cx - rect.left, cy - rect.top, factor);
            }
            this._lastTouchDist = dist;
        }
    }

    _onTouchEnd() {
        this.isDragging = false;
        this._lastTouchDist = 0;
    }

    _onMouseDown(e) {
        this.isDragging = true;
        this.dragStartX = e.clientX - this.offsetX;
        this.dragStartY = e.clientY - this.offsetY;
        this.canvas.style.cursor = 'grabbing';
    }

    _onMouseMove(e) {
        if (this.isDragging) {
            this.offsetX = e.clientX - this.dragStartX;
            this.offsetY = e.clientY - this.dragStartY;
            this.render();
            return;
        }

        // Hit-test for hover
        const pos = this._screenToWorld(e);
        const hit = this._hitTest(pos.x, pos.y);
        if (hit !== this.hoveredWedge) {
            this.hoveredWedge = hit;
            this.canvas.style.cursor = hit ? 'pointer' : 'grab';
            this.render();
        }
    }

    _onMouseUp() {
        this.isDragging = false;
        this.canvas.style.cursor = this.hoveredWedge ? 'pointer' : 'grab';
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
        const rect = this.canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        this._zoomAt(cx, cy, 2.0);
    }

    _onClick(e) {
        const pos = this._screenToWorld(e);
        const hit = this._hitTest(pos.x, pos.y);
        if (hit) {
            this.selectedWedge = hit;
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
        // Convert to polar coords relative to fan center
        const dx = wx - this.centerX;
        const dy = wy - this.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        for (const [id, layout] of this.fanLayout) {
            const inner = this._getRingInnerRadius(layout.ring);
            const outer = this._getRingOuterRadius(layout.ring);

            if (dist >= inner && dist <= outer) {
                // Check angle (handle wrapping)
                let a = angle;
                let sa = layout.startAngle;
                let ea = layout.endAngle;

                // Normalize
                if (a >= sa && a <= ea) {
                    return id;
                }
            }
        }
        return null;
    }

    _getRingInnerRadius(ring) {
        if (ring === 0) return 0;
        let r = this.innerRadius;
        for (let i = 1; i < ring; i++) {
            r += this._getRingWidth(i);
        }
        return r;
    }

    _getRingOuterRadius(ring) {
        if (ring === 0) return this.innerRadius;
        return this._getRingInnerRadius(ring) + this._getRingWidth(ring);
    }

    _getRingWidth(ring) {
        // Ring width decreases with generation but has a usable minimum
        // so outer generations remain clickable and visible
        return Math.max(18, this.ringWidth * Math.pow(0.92, ring - 1));
    }

    /**
     * Compute fan chart layout
     */
    computeLayout() {
        this.fanLayout.clear();
        this._visitedAncestors = new Set();
        const parser = this.app.parser;
        const rootId = this.app.rootPersonId;
        if (!rootId || !parser.persons.has(rootId)) return;

        // Center of the fan
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;

        // Root is at center (ring 0)
        this.fanLayout.set(rootId, {
            ring: 0,
            startAngle: this.startAngle,
            endAngle: this.endAngle
        });
        this._visitedAncestors.add(rootId);

        // Each person's parents share their angular range
        this._layoutAncestors(rootId, 1, this.startAngle, this.endAngle);

        this.maxGeneration = 0;
        for (const layout of this.fanLayout.values()) {
            if (layout.ring > this.maxGeneration) this.maxGeneration = layout.ring;
        }
    }

    _layoutAncestors(personId, ring, startAngle, endAngle) {
        const parser = this.app.parser;
        const person = parser.persons.get(personId);
        if (!person || !person.familyChildId) return;

        const family = parser.families.get(person.familyChildId);
        if (!family) return;

        const parents = [];
        if (family.husbandId && parser.persons.has(family.husbandId)) parents.push(family.husbandId);
        if (family.wifeId && parser.persons.has(family.wifeId)) parents.push(family.wifeId);

        if (parents.length === 0) return;

        const anglePerParent = (endAngle - startAngle) / parents.length;

        for (let i = 0; i < parents.length; i++) {
            const pStart = startAngle + i * anglePerParent;
            const pEnd = pStart + anglePerParent;

            // Skip already-visited ancestors (pedigree collapse protection)
            if (this._visitedAncestors.has(parents[i])) continue;
            this._visitedAncestors.add(parents[i]);

            this.fanLayout.set(parents[i], {
                ring: ring,
                startAngle: pStart,
                endAngle: pEnd
            });

            this._layoutAncestors(parents[i], ring + 1, pStart, pEnd);
        }
    }

    centerOnRoot() {
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;
    }

    resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth;
        this.canvas.height = this.canvas.parentElement.clientHeight;
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;
        this.render();
    }

    /**
     * Main render
     */
    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, w, h);

        if (this.fanLayout.size === 0) return;

        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);

        const parser = this.app.parser;

        // Draw wedges from outer to inner
        const entries = Array.from(this.fanLayout.entries());
        entries.sort((a, b) => b[1].ring - a[1].ring);

        for (const [id, layout] of entries) {
            const person = parser.persons.get(id);
            if (!person) continue;

            if (layout.ring === 0) {
                // Root: draw a circle
                this._drawRootCircle(ctx, person, id);
            } else {
                this._drawWedge(ctx, id, person, layout);
            }
        }

        ctx.restore();

        // Info
        ctx.fillStyle = '#6c757d';
        ctx.font = '12px monospace';
        ctx.fillText(`Zoom: ${(this.scale * 100).toFixed(0)}%  |  Generations: ${this.maxGeneration}  |  Ancestors: ${this.fanLayout.size}`, 10, h - 10);
    }

    _drawRootCircle(ctx, person, id) {
        const isSelected = id === this.selectedWedge;
        const isHovered = id === this.hoveredWedge;

        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, this.innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#bbdefb' : isHovered ? '#e3f2fd' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#1976d2';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Name
        ctx.fillStyle = '#212529';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const name = person.name || 'Unknown';
        const truncName = name.length > 18 ? name.substring(0, 16) + '...' : name;
        ctx.fillText(truncName, this.centerX, this.centerY - 8);

        // Dates
        const birthYear = this._extractYear(person.birthDate);
        const deathYear = this._extractYear(person.deathDate);
        if (birthYear || deathYear) {
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#6c757d';
            ctx.fillText(`${birthYear || '?'} - ${deathYear || ''}`, this.centerX, this.centerY + 8);
        }

        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    _drawWedge(ctx, id, person, layout) {
        const innerR = this._getRingInnerRadius(layout.ring);
        const outerR = this._getRingOuterRadius(layout.ring);
        const isSelected = id === this.selectedWedge;
        const isHovered = id === this.hoveredWedge;

        // Country highlight dimming
        if (this.highlightedCountry && person.country !== this.highlightedCountry) {
            ctx.globalAlpha = 0.15;
        }

        const countryColor = this.app.getCountryColor(person.country);
        // Generation-based fallback color when no country is assigned
        // Use vivid, distinct colors that stay visible at any generation depth
        const genHue = ((layout.ring || 0) * 67) % 360;
        const defaultColor = `hsl(${genHue}, 55%, 58%)`;
        const wedgeColor = countryColor || defaultColor;

        // Draw wedge
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, outerR, layout.startAngle, layout.endAngle);
        ctx.arc(this.centerX, this.centerY, innerR, layout.endAngle, layout.startAngle, true);
        ctx.closePath();

        // Fill with country color or generation-based color
        if (isSelected) {
            ctx.fillStyle = '#bbdefb';
        } else if (isHovered) {
            ctx.fillStyle = this._lightenColor(wedgeColor, 0.3);
        } else {
            ctx.fillStyle = wedgeColor;
        }
        ctx.fill();

        // Border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Text: only show if wedge is wide enough
        const arcLen = (layout.endAngle - layout.startAngle) * (innerR + outerR) / 2;
        const ringW = outerR - innerR;

        if (arcLen > 30 && ringW > 12) {
            const midAngle = (layout.startAngle + layout.endAngle) / 2;
            const midR = (innerR + outerR) / 2;
            const tx = this.centerX + Math.cos(midAngle) * midR;
            const ty = this.centerY + Math.sin(midAngle) * midR;

            ctx.save();
            ctx.translate(tx, ty);

            // Rotate text along the arc
            let textAngle = midAngle;
            if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
                textAngle += Math.PI;
            }
            ctx.rotate(textAngle);

            const fontSize = Math.min(10, Math.max(6, ringW * 0.6));
            ctx.font = `${fontSize}px sans-serif`;
            ctx.fillStyle = this._getContrastColor(countryColor || '#e9ecef');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const name = person.name || 'Unknown';
            const maxChars = Math.floor(arcLen / (fontSize * 0.6));
            const truncName = name.length > maxChars ? name.substring(0, maxChars - 1) + '..' : name;
            ctx.fillText(truncName, 0, 0);

            ctx.restore();
        }

        // Restore alpha
        ctx.globalAlpha = 1.0;
    }

    _lightenColor(color, amount) {
        if (!color) return color;
        // Handle hsl() strings
        const hslMatch = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
        if (hslMatch) {
            const h = parseFloat(hslMatch[1]);
            const s = parseFloat(hslMatch[2]);
            const l = Math.min(85, parseFloat(hslMatch[3]) + amount * 30);
            return `hsl(${h}, ${s}%, ${l}%)`;
        }
        // Handle hex
        if (color[0] !== '#') return color;
        let r = parseInt(color.slice(1, 3), 16);
        let g = parseInt(color.slice(3, 5), 16);
        let b = parseInt(color.slice(5, 7), 16);
        r = Math.min(255, Math.round(r + (255 - r) * amount));
        g = Math.min(255, Math.round(g + (255 - g) * amount));
        b = Math.min(255, Math.round(b + (255 - b) * amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    _getContrastColor(color) {
        if (!color) return '#000000';
        // Handle hsl() - lightness > 50% means dark text
        const hslMatch = color.match(/hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%\s*\)/);
        if (hslMatch) return parseFloat(hslMatch[1]) > 55 ? '#000000' : '#ffffff';
        if (color[0] !== '#') return '#000000';
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.5 ? '#000000' : '#ffffff';
    }

    _extractYear(dateStr) {
        if (!dateStr) return '';
        const match = dateStr.match(/(\d{4})/);
        return match ? match[1] : '';
    }

    /**
     * Render full fan chart for export
     */
    renderForExport(width, height) {
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = width;
        exportCanvas.height = height;
        const ectx = exportCanvas.getContext('2d');

        ectx.fillStyle = '#ffffff';
        ectx.fillRect(0, 0, width, height);

        // Compute total radius needed
        let totalRadius = this.innerRadius;
        for (let i = 1; i <= this.maxGeneration; i++) {
            totalRadius += this._getRingWidth(i);
        }

        // Scale to fit
        const maxDim = Math.min(width, height * 2) - 100;
        const exportScale = maxDim / (totalRadius * 2);

        // Save original center, set export center
        const origCX = this.centerX;
        const origCY = this.centerY;
        this.centerX = width / 2;
        this.centerY = height / 2;

        ectx.save();
        ectx.translate(0, 0);
        ectx.scale(exportScale, exportScale);
        this.centerX = width / (2 * exportScale);
        this.centerY = height / (2 * exportScale);

        const parser = this.app.parser;
        const entries = Array.from(this.fanLayout.entries());
        entries.sort((a, b) => b[1].ring - a[1].ring);

        for (const [id, layout] of entries) {
            const person = parser.persons.get(id);
            if (!person) continue;

            const origCtx = this.ctx;
            this.ctx = ectx;

            if (layout.ring === 0) {
                this._drawRootCircle(ectx, person, id);
            } else {
                this._drawWedge(ectx, id, person, layout);
            }

            this.ctx = origCtx;
        }

        ectx.restore();

        // Restore original center
        this.centerX = origCX;
        this.centerY = origCY;

        return exportCanvas;
    }
}
