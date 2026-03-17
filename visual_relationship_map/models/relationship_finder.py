# Part of FoxPink. See LICENSE file for full copyright and licensing details.
# -*- coding: utf-8 -*-
import re
from odoo import models, api

class RelationshipFinder(models.TransientModel):
    _name = 'visual_relationship_map.finder'
    _description = 'Relationship Finder'

    @api.model
    def get_related_docs(self, model, res_id, visited=None, depth=0, max_depth=5, origin_regex=r'[A-Z0-9/_-]+'):
        if visited is None:
            visited = set()
        
        key = f"{model}_{res_id}"
        if key in visited:
            return [], []
        visited.add(key)
        
        doc = self.env[model].browse(res_id)
        if not doc.exists():
            return [], []

        # Get display status and technical status for CSS
        state = doc.state if 'state' in doc._fields else ''
        status_label = dict(doc._fields['state'].selection).get(state) if state and doc._fields['state'].selection else state
        
        # Collect extra data for tooltips
        extra_info = []
        if 'amount_total' in doc._fields:
            symbol = doc.currency_id.symbol if 'currency_id' in doc._fields else ''
            extra_info.append(f"Total: {doc.amount_total} {symbol}")
        if 'date_order' in doc._fields:
            extra_info.append(f"Date: {doc.date_order.date()}")
        elif 'invoice_date' in doc._fields:
            extra_info.append(f"Date: {doc.invoice_date}")
        elif 'date_done' in doc._fields:
            extra_info.append(f"Date: {doc.date_done.date() if doc.date_done else ''}")

        nodes = [{
            'id': key,
            'name': doc.display_name,
            'model': model,
            'res_id': res_id,
            'status': status_label,
            'state': state,
            'tooltip': "\n".join(extra_info)
        }]
        edges = []

        if depth >= max_depth:
            return nodes, edges

        # Downstream logic
        if model == 'sale.order':
            for picking in doc.picking_ids:
                nodes_add, edges_add = self.get_related_docs('stock.picking', picking.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': key, 'target': f"stock.picking_{picking.id}"})
                edges.extend(edges_add)
                
            for invoice in doc.invoice_ids:
                nodes_add, edges_add = self.get_related_docs('account.move', invoice.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': key, 'target': f"account.move_{invoice.id}"})
                edges.extend(edges_add)

        elif model == 'purchase.order':
            for picking in doc.picking_ids:
                nodes_add, edges_add = self.get_related_docs('stock.picking', picking.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': key, 'target': f"stock.picking_{picking.id}"})
                edges.extend(edges_add)
            
            for invoice in doc.invoice_ids:
                nodes_add, edges_add = self.get_related_docs('account.move', invoice.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': key, 'target': f"account.move_{invoice.id}"})
                edges.extend(edges_add)

        elif model == 'stock.picking':
            if doc.backorder_id:
                nodes_add, edges_add = self.get_related_docs('stock.picking', doc.backorder_id.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': f"stock.picking_{doc.backorder_id.id}", 'target': key})
                edges.extend(edges_add)
            
            child_pickings = self.env['stock.picking'].search([('backorder_id', '=', doc.id)])
            for child in child_pickings:
                nodes_add, edges_add = self.get_related_docs('stock.picking', child.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': key, 'target': f"stock.picking_{child.id}"})
                edges.extend(edges_add)

        elif model == 'account.move':
            if hasattr(doc, 'reversed_entry_id') and doc.reversed_entry_id:
                nodes_add, edges_add = self.get_related_docs('account.move', doc.reversed_entry_id.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': f"account.move_{doc.reversed_entry_id.id}", 'target': key})
                edges.extend(edges_add)
            
            credit_notes = self.env['account.move'].search([('reversed_entry_id', '=', doc.id)])
            for cn in credit_notes:
                nodes_add, edges_add = self.get_related_docs('account.move', cn.id, visited, depth + 1, max_depth)
                nodes.extend(nodes_add)
                edges.append({'source': key, 'target': f"account.move_{cn.id}"})
                edges.extend(edges_add)

            if 'invoice_line_ids' in doc._fields and doc.invoice_line_ids:
                aml_fields = self.env['account.move.line']._fields
                if 'sale_line_ids' in aml_fields:
                    sale_orders = doc.invoice_line_ids.mapped('sale_line_ids.order_id')
                    for so in sale_orders:
                        if so:
                            nodes_add, edges_add = self.get_related_docs('sale.order', so.id, visited, depth + 1, max_depth)
                            nodes.extend(nodes_add)
                            edges.append({'source': f"sale.order_{so.id}", 'target': key})
                            edges.extend(edges_add)
                if 'purchase_line_id' in aml_fields:
                    purchase_orders = doc.invoice_line_ids.mapped('purchase_line_id.order_id')
                    for po in purchase_orders:
                        if po:
                            nodes_add, edges_add = self.get_related_docs('purchase.order', po.id, visited, depth + 1, max_depth)
                            nodes.extend(nodes_add)
                            edges.append({'source': f"purchase.order_{po.id}", 'target': key})
                            edges.extend(edges_add)

        # Smart Upstream Logic with Regex
        origin_text = ''
        if 'origin' in doc._fields and doc.origin:
            origin_text = doc.origin
        elif 'invoice_origin' in doc._fields and doc.invoice_origin:
            origin_text = doc.invoice_origin

        if origin_text:
            potential_names = re.findall(origin_regex, origin_text)
            for name in potential_names:
                # Check Sales
                so = self.env['sale.order'].search([('name', '=', name)], limit=1)
                if so:
                    nodes_add, edges_add = self.get_related_docs('sale.order', so.id, visited, depth + 1, max_depth, origin_regex)
                    nodes.extend(nodes_add)
                    edges.append({'source': f"sale.order_{so.id}", 'target': key})
                    edges.extend(edges_add)
                
                # Check Purchase
                po = self.env['purchase.order'].search([('name', '=', name)], limit=1)
                if po:
                    nodes_add, edges_add = self.get_related_docs('purchase.order', po.id, visited, depth + 1, max_depth, origin_regex)
                    nodes.extend(nodes_add)
                    edges.append({'source': f"purchase.order_{po.id}", 'target': key})
                    edges.extend(edges_add)

        return nodes, edges
