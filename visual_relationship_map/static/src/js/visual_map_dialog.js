/** @odoo-module **/
/* Part of FoxPink. See LICENSE file for full copyright and licensing details. */

import { Component, onWillStart, useRef, useEffect, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";

export class VisualMapDialog extends Component {
    static template = "visual_relationship_map.MapDialog";
    static props = {
        action: Object,
        actionId: { type: Number, optional: true },
        className: { type: String, optional: true },
        // Odoo may pass this prop when mounting client actions; mark as optional to avoid Owl validation errors
        updateActionState: { type: Function, optional: true },
    };

    setup() {
        this.actionService = this.env.services?.action || null;
        this.mermaidRef = useRef("mermaid_container");
        this.stageRef = useRef("mermaid_container");
        this.data = { nodes: [], edges: [], current_doc_id: null };
        const context = this.props.action?.context || {};
        this.activeModel = context.active_model;
        this.activeId = context.active_id;
        this.view = { scale: 1, tx: 0, ty: 0, isPanning: false, panX: 0, panY: 0, startTx: 0, startTy: 0 };
        this.ui = useState({ tooltipVisible: false, tooltipText: "", tooltipX: 0, tooltipY: 0 });

        onWillStart(async () => {
            if (!this.activeModel || !this.activeId) {
                this.data = { nodes: [], edges: [], current_doc_id: null };
                return;
            }
            const result = await this.callJsonRpc("/visual_map/get_data", {
                model: this.activeModel,
                res_id: this.activeId,
            });
            if (result && result.error) {
                console.error("Server Logic Error:", result.error);
                this.data = { nodes: [], edges: [], current_doc_id: null, serverError: result.error };
            } else {
                this.data = result || { nodes: [], edges: [], current_doc_id: null };
            }
        });

        useEffect(() => {
            this.renderDiagram();
        }, () => []);

        useEffect(() => {
            const onKeyDown = (ev) => {
                if (ev.key === "Escape") {
                    if (this.actionService) {
                        this.actionService.doAction({ type: "ir.actions.act_window_close" });
                    }
                } else if (ev.key && ev.key.toLowerCase() === "f") {
                    this.fitToView();
                } else if (ev.key === "+") {
                    this.zoomIn();
                } else if (ev.key === "-") {
                    this.zoomOut();
                }
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
        }, () => []);

        useEffect(() => {
            const stage = this.stageRef.el;
            if (!stage) return;
            const modalBody = stage.closest(".modal-body");
            if (!modalBody) return;
            const prevOverflow = modalBody.style.overflow;
            const prevOverflowY = modalBody.style.overflowY;
            modalBody.style.overflow = "hidden";
            modalBody.style.overflowY = "hidden";
            return () => {
                modalBody.style.overflow = prevOverflow;
                modalBody.style.overflowY = prevOverflowY;
            };
        }, () => []);
    }

    async callJsonRpc(route, params) {
        const response = await fetch(route, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "call",
                params,
                id: Date.now(),
            }),
            credentials: "include",
        });
        const payload = await response.json();
        if (payload.error) {
            throw new Error(payload.error.message || "JSON-RPC error");
        }
        return payload.result;
    }

    async renderDiagram() {
        if (!this.data.nodes || !this.stageRef.el) return;
        this.stageRef.el.innerHTML = "";
        let graphDefinition = "graph LR\n";

        const modelPriority = {
            "sale.order": 10,
            "purchase.order": 20,
            "stock.picking": 30,
            "account.move": 40,
        };

        const sortedNodes = [...this.data.nodes].sort((a, b) => {
            const pa = modelPriority[a.model] ?? 99;
            const pb = modelPriority[b.model] ?? 99;
            if (pa !== pb) return pa - pb;
            const na = (a.name || "").toLowerCase();
            const nb = (b.name || "").toLowerCase();
            if (na !== nb) return na.localeCompare(nb);
            return String(a.id).localeCompare(String(b.id));
        });

        const nodeById = new Map(sortedNodes.map((n) => [n.id, n]));

        sortedNodes.forEach((node) => {
            const nodeId = this.toMermaidId(node.id);
            const statusClass = `status-${node.state || 'default'}`;
            
            const title = this.escapeHtml(node.name);
            const badgeText = this.escapeHtml(node.status);
            const badgeVariant = this.getBadgeVariant(node.model, node.state);
            const label = `<div class='vrm-node'><div class='vrm-title'>${title}</div><div class='vrm-badge vrm-badge--${badgeVariant}'>${badgeText}</div></div>`;

            graphDefinition += `  ${nodeId}["${label}"]\n`;
            graphDefinition += `  class ${nodeId} ${statusClass}\n`;
            if (node.id === this.data.current_doc_id) {
                graphDefinition += `  style ${nodeId} stroke:#714B67,stroke-width:3px\n`;
            }
        });

        const sortedEdges = [...(this.data.edges || [])].sort((a, b) => {
            const aSrc = nodeById.get(a.source);
            const aTgt = nodeById.get(a.target);
            const bSrc = nodeById.get(b.source);
            const bTgt = nodeById.get(b.target);

            const aSrcP = aSrc ? (modelPriority[aSrc.model] ?? 99) : 999;
            const bSrcP = bSrc ? (modelPriority[bSrc.model] ?? 99) : 999;
            if (aSrcP !== bSrcP) return aSrcP - bSrcP;

            const aTgtP = aTgt ? (modelPriority[aTgt.model] ?? 99) : 999;
            const bTgtP = bTgt ? (modelPriority[bTgt.model] ?? 99) : 999;
            if (aTgtP !== bTgtP) return aTgtP - bTgtP;

            const aKey = `${a.source}->${a.target}`;
            const bKey = `${b.source}->${b.target}`;
            return aKey.localeCompare(bKey);
        });

        sortedEdges.forEach((edge) => {
            const sourceId = this.toMermaidId(edge.source);
            const targetId = this.toMermaidId(edge.target);
            graphDefinition += `  ${sourceId} --> ${targetId}\n`;
        });

        try {
            mermaid.initialize({
                startOnLoad: false,
                theme: "neutral",
                securityLevel: "loose",
                flowchart: { htmlLabels: true },
            });
            const { svg } = await mermaid.render(`mermaid_svg_${Date.now()}`, graphDefinition);
            this.stageRef.el.innerHTML = svg;
            const svgEl = this.stageRef.el.querySelector("svg");
            if (svgEl) {
                svgEl.style.maxWidth = "none";
                const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
                if (vb && vb.width && vb.height) {
                    svgEl.style.width = `${Math.ceil(vb.width)}px`;
                    svgEl.style.height = `${Math.ceil(vb.height)}px`;
                }
            }
            this.resetView();
            this.fitToView();
            this.installPanZoom();
            this.attachEvents();
        } catch (error) {
            console.error("Mermaid Render Error:", error);
            this.stageRef.el.innerHTML = `Error rendering diagram: ${error.message}`;
        }
    }

    installPanZoom() {
        const stage = this.stageRef.el;
        if (!stage) return;
        if (stage.__vrmPanZoomInstalled) return;
        stage.__vrmPanZoomInstalled = true;

        const onPointerDown = (ev) => {
            if (ev.button !== undefined && ev.button !== 0) return;
            // Do not start panning if the pointer is on a node (so that click works)
            const isOnNode =
                (ev.target && ev.target.closest && ev.target.closest(".node")) ||
                (ev.composedPath && ev.composedPath().some((n) => n && n.classList && n.classList.contains && n.classList.contains("node")));
            if (isOnNode) {
                return;
            }
            this.view.isPanning = true;
            this.view.panX = ev.clientX;
            this.view.panY = ev.clientY;
            this.view.startTx = this.view.tx;
            this.view.startTy = this.view.ty;
            stage.classList.add("is-grabbing");
            stage.setPointerCapture?.(ev.pointerId);
        };

        const onPointerMove = (ev) => {
            if (!this.view.isPanning) return;
            const dx = ev.clientX - this.view.panX;
            const dy = ev.clientY - this.view.panY;
            // Only move if the drag crosses a small threshold to avoid accidental drags
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            this.view.tx = this.view.startTx + dx;
            this.view.ty = this.view.startTy + dy;
            this.applyTransform();
        };

        const endPan = () => {
            this.view.isPanning = false;
            stage.classList.remove("is-grabbing");
        };

        stage.addEventListener("pointerdown", onPointerDown);
        stage.addEventListener("pointermove", onPointerMove);
        stage.addEventListener("pointerup", endPan);
        stage.addEventListener("pointercancel", endPan);
        stage.addEventListener("pointerleave", endPan);

        stage.addEventListener(
            "wheel",
            (ev) => {
                ev.preventDefault();
                const delta = ev.deltaY > 0 ? -1 : 1;
                const factor = delta > 0 ? 1.1 : 0.9;
                this.zoomAt(factor, ev.clientX, ev.clientY);
            },
            { passive: false }
        );
    }

    applyTransform() {
        const stage = this.stageRef.el;
        if (!stage) return;
        stage.style.transformOrigin = "0 0";
        stage.style.transform = `translate(${this.view.tx}px, ${this.view.ty}px) scale(${this.view.scale})`;
    }

    zoomAt(factor, clientX, clientY) {
        const container = this.stageRef.el?.parentElement;
        const stage = this.stageRef.el;
        if (!container || !stage) return;
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const prevScale = this.view.scale;
        const nextScale = Math.min(3, Math.max(0.3, prevScale * factor));
        const k = nextScale / prevScale;

        this.view.tx = x - k * (x - this.view.tx);
        this.view.ty = y - k * (y - this.view.ty);
        this.view.scale = nextScale;
        this.applyTransform();
    }

    zoomIn() {
        const container = this.stageRef.el?.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        this.zoomAt(1.15, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    zoomOut() {
        const container = this.stageRef.el?.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        this.zoomAt(0.87, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    resetView() {
        this.view.scale = 1;
        this.view.tx = 0;
        this.view.ty = 0;
        this.applyTransform();
    }

    fitToView() {
        const container = this.stageRef.el?.parentElement;
        const svgEl = this.stageRef.el?.querySelector("svg");
        if (!container || !svgEl) return;
        const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
        const svgWidth = vb && vb.width ? vb.width : svgEl.getBoundingClientRect().width;
        const svgHeight = vb && vb.height ? vb.height : svgEl.getBoundingClientRect().height;
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        if (!svgWidth || !svgHeight || !cw || !ch) return;

        const scale = Math.min(1.5, Math.max(0.3, Math.min(cw / svgWidth, ch / svgHeight) * 0.92));
        this.view.scale = scale;
        this.view.tx = Math.round((cw - svgWidth * scale) / 2);
        this.view.ty = Math.round((ch - svgHeight * scale) / 2);
        this.applyTransform();
    }

    exportPNG() {
        const svgEl = this.stageRef.el?.querySelector("svg");
        if (!svgEl) return;
        const { svgText, width, height } = this.buildStyledSVG(svgEl);
        const img = new Image();
        img.crossOrigin = "anonymous";
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0);
            const link = document.createElement("a");
            link.href = canvas.toDataURL("image/png");
            link.download = "relationship_map.png";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
        img.src = url;
    }

    exportSVG() {
        const svgEl = this.stageRef.el?.querySelector("svg");
        if (!svgEl) return;
        const { svgText } = this.buildStyledSVG(svgEl);
        const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "relationship_map.svg";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    buildStyledSVG(svgEl) {
        const clone = svgEl.cloneNode(true);
        // Ensure width/height are explicit for export
        const vb = clone.viewBox && clone.viewBox.baseVal;
        const width = Math.ceil(vb && vb.width ? vb.width : clone.getBoundingClientRect().width || 1200);
        const height = Math.ceil(vb && vb.height ? vb.height : clone.getBoundingClientRect().height || 800);
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));

        let cssText = "";
        try {
            for (const sheet of Array.from(document.styleSheets)) {
                // Only inline our module css or inline styles from mermaid
                const href = sheet.href || "";
                if (href.includes("visual_map.css") || href.includes("web.assets_backend")) {
                    const rules = sheet.cssRules || [];
                    for (const r of Array.from(rules)) {
                        // Keep only relevant selectors to reduce size
                        if (r.cssText && (
                            r.cssText.includes(".vrm-") ||
                            r.cssText.includes(".status-") ||
                            r.cssText.includes(".node") ||
                            r.cssText.includes(".edge")
                        )) {
                            cssText += r.cssText + "\n";
                        }
                    }
                }
            }
        } catch (_) {
            // Fallback minimal styles if accessing cssRules is not allowed
            cssText += ".vrm-node{font-family:Segoe UI,Arial,sans-serif;font-size:12px}.vrm-title{font-weight:600}.vrm-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}";
        }

        // Merge any inline <style> that Mermaid injected into the SVG
        const existingStyle = clone.querySelector("style");
        const styleEl = existingStyle || document.createElementNS("http://www.w3.org/2000/svg", "style");
        styleEl.setAttribute("type", "text/css");
        styleEl.innerHTML = (existingStyle ? existingStyle.innerHTML : "") + "\n" + cssText;
        if (!existingStyle) {
            clone.insertBefore(styleEl, clone.firstChild);
        }

        const serializer = new XMLSerializer();
        const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(clone)}`;
        return { svgText, width, height };
    }

    escapeHtml(text) {
        if (!text) return "";
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    getBadgeVariant(model, state) {
        const s = String(state || "").toLowerCase();
        if (["cancel", "cancelled", "canceled", "void"].includes(s)) return "cancel";
        if (["done", "posted", "paid"].includes(s)) return "done";
        if (["draft"].includes(s)) return "draft";
        if (["waiting", "confirmed", "to_approve", "to_invoice", "sent"].includes(s)) return "warning";
        if (["sale", "purchase", "assigned", "ready", "progress"].includes(s)) return "progress";
        if (model === "account.move" && s === "posted") return "done";
        return "neutral";
    }

    toMermaidId(rawId) {
        return String(rawId).replace(/[^a-zA-Z0-9_]/g, "_");
    }

    attachEvents() {
        const nodes = this.stageRef.el.querySelectorAll(".node");
        nodes.forEach((nodeEl) => {
            nodeEl.style.cursor = "pointer";
            
            // Find matched node data
            const matchedNode = this.data.nodes.find((node) =>
                nodeEl.id.includes(this.toMermaidId(node.id))
            );

            if (matchedNode) {
                nodeEl.removeAttribute("title");
                const labelEl = nodeEl.querySelector(".vrm-node");
                if (labelEl) labelEl.removeAttribute("title");

                nodeEl.onpointerdown = (ev) => {
                    // Stop pan from starting when clicking a node
                    ev.stopPropagation();
                };
                nodeEl.onpointerenter = (ev) => {
                    if (!matchedNode.tooltip) return;
                    this.showTooltip(matchedNode.tooltip, ev.clientX, ev.clientY);
                };

                nodeEl.onpointermove = (ev) => {
                    if (!this.ui.tooltipVisible) return;
                    this.moveTooltip(ev.clientX, ev.clientY);
                };

                nodeEl.onpointerleave = () => {
                    this.hideTooltip();
                };

                nodeEl.onclick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.openRecord(matchedNode.model, matchedNode.res_id);
                };
            }
        });
    }

    showTooltip(text, clientX, clientY) {
        this.ui.tooltipText = text;
        this.ui.tooltipVisible = true;
        this.moveTooltip(clientX, clientY);
    }

    moveTooltip(clientX, clientY) {
        const padding = 12;
        const maxWidth = 280;
        const maxHeight = 140;

        let x = Math.round(clientX + padding);
        let y = Math.round(clientY + padding);

        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        x = Math.max(padding, Math.min(x, Math.round(vw - maxWidth - padding)));
        y = Math.max(padding, Math.min(y, Math.round(vh - maxHeight - padding)));

        this.ui.tooltipX = x;
        this.ui.tooltipY = y;
    }

    hideTooltip() {
        this.ui.tooltipVisible = false;
    }

    openRecord(model, resId) {
        if (this.actionService) {
            this.actionService.doAction({
                        type: "ir.actions.act_window",
                        res_model: model,
                        res_id: resId,
                        views: [[false, "form"]],
                        target: "current",
                    });
            return;
        }
        window.location.href = `/web#model=${encodeURIComponent(model)}&id=${resId}&view_type=form`;
    }
}

// Register Client Action
registry.category("actions").add("visual_relationship_map.view", VisualMapDialog);
