# -*- coding: utf-8 -*-
from odoo import http
from odoo.http import request

class VisualMapController(http.Controller):

    @http.route('/visual_map/get_data', type='json', auth='user', csrf=False)
    def get_data(self, model, res_id):
        if not model or not res_id:
            return {'nodes': [], 'edges': [], 'current_doc_id': None}
        
        try:
            res_id = int(res_id)
        except (ValueError, TypeError):
            return {'nodes': [], 'edges': [], 'current_doc_id': None}

        try:
            icp = request.env['ir.config_parameter'].sudo()
            max_depth = int(icp.get_param('visual_relationship_map.max_depth', '5') or '5')
            origin_regex = icp.get_param('visual_relationship_map.origin_regex', r'[A-Z0-9/_-]+') or r'[A-Z0-9/_-]+'

            finder = request.env['visual_relationship_map.finder']
            nodes, edges = finder.get_related_docs(model, res_id, None, 0, max_depth, origin_regex)
            
            # Remove duplicate nodes and edges using a safer method
            unique_nodes_dict = {}
            for node in nodes:
                unique_nodes_dict[node['id']] = node
            
            unique_edges_dict = {}
            for edge in edges:
                edge_key = f"{edge['source']}->{edge['target']}"
                unique_edges_dict[edge_key] = edge

            return {
                'nodes': list(unique_nodes_dict.values()),
                'edges': list(unique_edges_dict.values()),
                'current_doc_id': f"{model}_{res_id}"
            }
        except Exception as e:
            # You can check the server logs for the full traceback
            return {'error': str(e), 'nodes': [], 'edges': [], 'current_doc_id': None}
