/**
 * Export — PDF/PNG at 36-inch scroll dimensions
 */

class ExportManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * Show export dialog
     */
    showDialog() {
        const dialog = document.getElementById('export-dialog');
        dialog.classList.add('active');
    }

    hideDialog() {
        const dialog = document.getElementById('export-dialog');
        dialog.classList.remove('active');
    }

    /**
     * Execute export with given options
     */
    async doExport(format, widthInches, dpi) {
        const widthPx = Math.round(widthInches * dpi);

        // Determine height based on content aspect ratio
        const view = this.app.currentView;
        let heightPx;

        if (view === 'tree' && this.app.treeView) {
            const bounds = this.app.treeView.treeBounds;
            const treeW = bounds.maxX - bounds.minX;
            const treeH = bounds.maxY - bounds.minY;
            const aspect = treeH / treeW;
            heightPx = Math.round(widthPx * aspect) + 200; // padding
            heightPx = Math.max(heightPx, dpi * 12); // minimum 12 inches tall
        } else if (view === 'fan' && this.app.fanView) {
            // Fan chart is roughly square/semicircle
            heightPx = Math.round(widthPx * 0.6);
        } else {
            heightPx = Math.round(widthPx * 0.5);
        }

        // Show progress
        this._showProgress('Rendering...');

        // Small delay to let UI update
        await new Promise(r => setTimeout(r, 50));

        try {
            let exportCanvas;

            if (view === 'tree' && this.app.treeView) {
                exportCanvas = this.app.treeView.renderForExport(widthPx, heightPx);
            } else if (view === 'fan' && this.app.fanView) {
                exportCanvas = this.app.fanView.renderForExport(widthPx, heightPx);
            } else {
                this._showProgress('No view to export');
                return;
            }

            if (format === 'png') {
                await this._exportPNG(exportCanvas);
            } else if (format === 'pdf') {
                await this._exportPDF(exportCanvas, widthInches, dpi);
            }

            this._showProgress('Export complete!');
            setTimeout(() => this.hideDialog(), 1500);
        } catch (err) {
            console.error('Export error:', err);
            this._showProgress('Export failed: ' + err.message);
        }
    }

    async _exportPNG(canvas) {
        this._showProgress('Creating PNG...');

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Failed to create image blob'));
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'family-tree.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                resolve();
            }, 'image/png');
        });
    }

    async _exportPDF(canvas, widthInches, dpi) {
        this._showProgress('Creating PDF...');

        if (typeof window.jspdf === 'undefined') {
            throw new Error('jsPDF library not loaded. Check your internet connection.');
        }

        const { jsPDF } = window.jspdf;

        const canvasWidthInches = canvas.width / dpi;
        const canvasHeightInches = canvas.height / dpi;

        // Create PDF with custom page size matching the scroll
        const pdf = new jsPDF({
            orientation: canvasWidthInches > canvasHeightInches ? 'landscape' : 'portrait',
            unit: 'in',
            format: [canvasWidthInches, canvasHeightInches]
        });

        // Add the canvas as an image
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, canvasWidthInches, canvasHeightInches);

        pdf.save('family-tree.pdf');
    }

    _showProgress(msg) {
        const el = document.getElementById('export-progress');
        if (el) el.textContent = msg;
    }
}
