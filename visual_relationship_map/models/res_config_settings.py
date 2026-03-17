# -*- coding: utf-8 -*-
from odoo import api, fields, models


class VisualMapSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    vrm_max_depth = fields.Integer(
        string="Max recursion depth",
        default=5,
        help="Maximum levels to traverse when building the relationship map."
    )
    vrm_origin_regex = fields.Char(
        string="Origin regex pattern",
        default=r'[A-Z0-9/_-]+',
        help="Regex used to extract document references from origin/invoice_origin."
    )

    def set_values(self):
        super().set_values()
        icp = self.env['ir.config_parameter'].sudo()
        icp.set_param('visual_relationship_map.max_depth', str(self.vrm_max_depth or 5))
        icp.set_param('visual_relationship_map.origin_regex', self.vrm_origin_regex or r'[A-Z0-9/_-]+')

    @api.model
    def get_values(self):
        res = super().get_values()
        icp = self.env['ir.config_parameter'].sudo()
        res.update(
            vrm_max_depth=int(icp.get_param('visual_relationship_map.max_depth', '5') or '5'),
            vrm_origin_regex=icp.get_param('visual_relationship_map.origin_regex', r'[A-Z0-9/_-]+') or r'[A-Z0-9/_-]+',
        )
        return res

