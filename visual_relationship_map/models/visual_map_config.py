# -*- coding: utf-8 -*-
from odoo import api, fields, models


class VisualRelationshipMapConfig(models.TransientModel):
    _name = 'visual.relationship.map.config'
    _description = 'Visual Relationship Map Settings'

    vrm_max_depth = fields.Integer(string="Max recursion depth", default=5)
    vrm_origin_regex = fields.Char(string="Origin regex pattern", default=r'[A-Z0-9/_-]+')

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        icp = self.env['ir.config_parameter'].sudo()
        res['vrm_max_depth'] = int(icp.get_param('visual_relationship_map.max_depth', '5') or '5')
        res['vrm_origin_regex'] = icp.get_param('visual_relationship_map.origin_regex', r'[A-Z0-9/_-]+') or r'[A-Z0-9/_-]+'
        return res

    def action_save(self):
        self.ensure_one()
        icp = self.env['ir.config_parameter'].sudo()
        icp.set_param('visual_relationship_map.max_depth', str(self.vrm_max_depth or 5))
        icp.set_param('visual_relationship_map.origin_regex', self.vrm_origin_regex or r'[A-Z0-9/_-]+')
        return {'type': 'ir.actions.act_window_close'}

