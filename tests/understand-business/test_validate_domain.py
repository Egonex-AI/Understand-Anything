#!/usr/bin/env python3
import json
import pytest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'understand-anything-plugin' / 'skills' / 'understand-business'))
from validate_domain import validate_domain_doc


class TestValidateDomainDoc:
    def test_valid_minimal_doc(self):
        doc = {
            'id': 'domain:order-management',
            'name': '订单管理',
            'summary': '用户从下单到支付完成的完整业务流程',
            'interactions': [{
                'id': 'flow:create-order',
                'name': '创建订单',
                'steps': [
                    {'id': 'step:1', 'facet': 'client', 'description': '用户点击下单', 'after': []},
                    {'id': 'step:2', 'facet': 'server', 'description': '校验库存', 'after': ['step:1'], 'terminal': True},
                ]
            }],
            'businessRules': [],
            'facets': {'server': {'domainRef': 'server/order-service/.understand-anything/wiki/domains/order-management.json'}}
        }
        errors = validate_domain_doc(doc)
        assert len(errors) == 0

    def test_missing_id(self):
        doc = {'name': 'test', 'summary': 'test', 'interactions': [], 'businessRules': [], 'facets': {}}
        errors = validate_domain_doc(doc)
        assert any('id' in e for e in errors)

    def test_invalid_id_pattern(self):
        doc = {'id': 'invalid', 'name': 'test', 'summary': 'test', 'interactions': [], 'businessRules': [], 'facets': {}}
        errors = validate_domain_doc(doc)
        assert any('domain:' in e for e in errors)

    def test_invalid_step_reference_in_after(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [{
                'id': 'flow:test',
                'name': 'test',
                'steps': [
                    {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': ['step:nonexistent']},
                ]
            }],
            'businessRules': [],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('nonexistent' in e for e in errors)

    def test_invalid_branch_next_reference(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [{
                'id': 'flow:test',
                'name': 'test',
                'steps': [
                    {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': [],
                     'branches': [{'condition': 'ok', 'next': ['step:missing']}]},
                ]
            }],
            'businessRules': [],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('missing' in e for e in errors)

    def test_no_terminal_step_warns(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [{
                'id': 'flow:test',
                'name': 'test',
                'steps': [
                    {'id': 'step:1', 'facet': 'server', 'description': 'test', 'after': []},
                ]
            }],
            'businessRules': [],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('terminal' in e.lower() for e in errors)

    def test_business_rule_missing_required_fields(self):
        doc = {
            'id': 'domain:test',
            'name': 'test',
            'summary': 'test',
            'interactions': [],
            'businessRules': [{'id': 'rule:1'}],
            'facets': {}
        }
        errors = validate_domain_doc(doc)
        assert any('rule' in e or 'enforcedBy' in e for e in errors)
