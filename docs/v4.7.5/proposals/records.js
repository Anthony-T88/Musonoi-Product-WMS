window.PreviewRecords={
  "testOrigin": "http://127.0.0.1:4185",
  "copper": [
    {
      "id": "IN_STOCK",
      "scenario": "在库捆包",
      "code": "MUS-2026-024-1794474311264",
      "status": "备货锁定",
      "location": "P1-03",
      "batch": "RMM-CU-2026-91",
      "customer": "Synthetic CU-AUDIT",
      "gross": "2.0350",
      "net": "2.0325",
      "docs": [
        {
          "kind": "入库",
          "code": "IN-20261112-04",
          "at": "2026/11/12 11:05:11",
          "status": "已确认",
          "href": "/receipts/697ff7d9-f5fc-45f7-b2a8-610f55e5678f"
        },
        {
          "kind": "备货",
          "code": "RMM-CU-2026-91",
          "at": "2026/11/12 11:05:16",
          "status": "PREPARED",
          "href": "/preparation/3882a727-fc99-4966-88ed-57efded706b0"
        }
      ],
      "history": [
        [
          "2026/11/12 11:05:16",
          "INBOUND",
          "Audit production_manager",
          "IN-20261112-04"
        ],
        [
          "2026/11/12 11:05:16",
          "LOCK",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "CREATE_ITEM",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "创建Lot并开始备货，立即锁定",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "ADJUST_WEIGHT",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "WEIGH",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "取样/复磅后须重新确认铅封",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "SEAL",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "提交",
          "Audit logistics_field_operator",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "货位变更",
          "Audit site_supervisor",
          "RMM-CU-2026-91"
        ],
        [
          "2026/11/12 11:05:16",
          "审核通过",
          "Audit site_supervisor",
          "RMM-CU-2026-91"
        ]
      ],
      "archive": [
        {
          "title": "标识与档案",
          "fields": [
            [
              "捆包编号",
              "MUS-2026-024-1794474311264"
            ],
            [
              "产品",
              "阴极铜"
            ],
            [
              "生产日期",
              "2026-11-12"
            ],
            [
              "捆包片数",
              48
            ],
            [
              "铅封号",
              "V475-CONCURRENT-1794474311264-1"
            ],
            [
              "入库时间",
              "2026/11/12 11:05:11"
            ],
            [
              "来源",
              "库存视图与入库单"
            ]
          ]
        },
        {
          "title": "库存与重量",
          "fields": [
            [
              "库存状态",
              "备货锁定"
            ],
            [
              "当前货位",
              "P1-03"
            ],
            [
              "客户",
              "Synthetic CU-AUDIT"
            ],
            [
              "毛重（MT）",
              "2.0350"
            ],
            [
              "净重（MT）",
              "2.0325"
            ],
            [
              "来源",
              "库存视图与有效检斤"
            ]
          ]
        },
        {
          "title": "业务关联",
          "fields": [
            [
              "备货批次",
              "RMM-CU-2026-91"
            ],
            [
              "入库单号",
              "IN-20261112-04"
            ],
            [
              "来源",
              "备货单与业务流水"
            ]
          ]
        }
      ]
    },
    {
      "id": "OUTBOUND",
      "scenario": "已出库捆包",
      "code": "MUS-2026-020-1794474311264",
      "status": "已正式出库",
      "location": "P1-01",
      "batch": "RMM-CU-2026-01",
      "customer": "Synthetic CU-AUDIT",
      "gross": "2.0350",
      "net": "2.0325",
      "docs": [
        {
          "kind": "入库",
          "code": "IN-20261112-01",
          "at": "2026/11/12 11:05:11",
          "status": "已确认",
          "href": "/receipts/5102b3bf-08bf-498f-94a8-897ad53330af"
        },
        {
          "kind": "备货",
          "code": "RMM-CU-2026-01",
          "at": "2026/11/12 11:05:13",
          "status": "已完成",
          "href": "/preparation/35d22087-3f1e-4ef5-a6b2-74e6985e4103"
        },
        {
          "kind": "装车",
          "code": "LOAD-20261112-01",
          "at": "2026/11/12 11:05:14",
          "status": "已正式出库",
          "href": "/outbounds/loads/54ca3b55-4c8d-4240-9a20-f67745dc6f97"
        },
        {
          "kind": "正式出库",
          "code": "LOAD-20261112-01",
          "at": "2026/11/12 11:05:14",
          "status": "已正式出库",
          "href": "/outbounds/loads/54ca3b55-4c8d-4240-9a20-f67745dc6f97"
        }
      ],
      "history": [
        [
          "2026/11/12 11:05:11",
          "INBOUND",
          "Audit production_manager",
          "IN-20261112-01"
        ],
        [
          "2026/11/12 11:05:11",
          "LOCK",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:11",
          "CREATE_ITEM",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:11",
          "创建Lot并开始备货，立即锁定",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:11",
          "SAMPLE-STAGE",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "取样/复磅后须重新确认铅封",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "SAMPLE-STAGE",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "取样/复磅后须重新确认铅封",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "ADJUST_WEIGHT",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "WEIGH",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "取样/复磅后须重新确认铅封",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "SEAL",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:12",
          "提交",
          "Audit logistics_field_operator",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:13",
          "货位变更",
          "Audit site_supervisor",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:13",
          "审核通过",
          "Audit site_supervisor",
          "RMM-CU-2026-01"
        ],
        [
          "2026/11/12 11:05:13",
          "提交装车审核",
          "Audit admin",
          "RMM-2609-CU-MECR-7500-02-PL"
        ],
        [
          "2026/11/12 11:05:13",
          "匹配装车计划单及实际装车捆包",
          "Audit admin",
          "RMM-2609-CU-MECR-7500-02-PL"
        ],
        [
          "2026/11/12 11:05:13",
          "匹配装车计划单及实际装车捆包",
          "Audit admin",
          "RMM-2609-CU-MECR-7500-02-PL"
        ],
        [
          "2026/11/12 11:05:14",
          "LOAD",
          "Audit site_supervisor",
          "LOAD-20261112-01"
        ],
        [
          "2026/11/12 11:05:14",
          "审核通过",
          "Audit site_supervisor",
          "RMM-2609-CU-MECR-7500-02-PL"
        ],
        [
          "2026/11/12 11:05:14",
          "DEPART",
          "Audit logistics_field_operator",
          "RMM-2609-CU-MECR-7500-02-PL"
        ],
        [
          "2026/11/12 11:05:14",
          "LOGISTICS-APPROVE",
          "Audit logistics_manager",
          "RMM-2609-CU-MECR-7500-02-PL"
        ],
        [
          "2026/11/12 11:05:14",
          "UNLOCK",
          "Audit production_manager",
          "LOAD-20261112-01"
        ],
        [
          "2026/11/12 11:05:14",
          "已正式出库",
          "Audit production_manager",
          "LOAD-20261112-01"
        ],
        [
          "2026/11/12 11:05:14",
          "MANAGER-APPROVE",
          "Audit production_manager",
          "RMM-2609-CU-MECR-7500-02-PL"
        ]
      ],
      "archive": [
        {
          "title": "标识与档案",
          "fields": [
            [
              "捆包编号",
              "MUS-2026-020-1794474311264"
            ],
            [
              "产品",
              "阴极铜"
            ],
            [
              "生产日期",
              "2026-11-12"
            ],
            [
              "捆包片数",
              48
            ],
            [
              "铅封号",
              "RC2-CU-1794474311264-b48ead56"
            ],
            [
              "入库时间",
              "2026/11/12 11:05:11"
            ],
            [
              "来源",
              "库存视图与入库单"
            ]
          ]
        },
        {
          "title": "库存与重量",
          "fields": [
            [
              "库存状态",
              "已正式出库"
            ],
            [
              "当前货位",
              "P1-01"
            ],
            [
              "客户",
              "Synthetic CU-AUDIT"
            ],
            [
              "毛重（MT）",
              "2.0350"
            ],
            [
              "净重（MT）",
              "2.0325"
            ],
            [
              "来源",
              "库存视图与有效检斤"
            ]
          ]
        },
        {
          "title": "业务关联",
          "fields": [
            [
              "备货批次",
              "RMM-CU-2026-01"
            ],
            [
              "入库单号",
              "IN-20261112-01"
            ],
            [
              "来源",
              "备货单与业务流水"
            ]
          ]
        }
      ]
    }
  ],
  "cobalt": [
    {
      "id": "297b01e2-4ebb-4bc4-bd9f-29e69fbcef77",
      "kind": "stock",
      "scenario": "在库批次",
      "code": "RMM-CO-2026-202",
      "status": "备货作业中",
      "bags": 2,
      "net": "1.3041",
      "grade": null,
      "estimated": "0.46949",
      "confirmed": null,
      "units": [
        [
          "MUS-CO-261112-004",
          null,
          "660.1250",
          "657.1250",
          "未标记取样",
          "备货作业中"
        ],
        [
          "MUS-CO-261112-005",
          null,
          null,
          null,
          "未标记取样",
          "备货作业中"
        ]
      ],
      "docs": [
        {
          "kind": "备货计划",
          "code": "RMM-CO-2026-202",
          "at": "2026/11/12 11:05:00",
          "status": "已审批",
          "href": "/preparation/work-plans/fbf8cde2-b76f-4a58-b853-de73a529cc95"
        },
        {
          "kind": "入库备货单",
          "code": "CO-PREP-261112-02",
          "at": "2026/11/12 11:05:00",
          "status": "已入库",
          "href": "/receipts/297b01e2-4ebb-4bc4-bd9f-29e69fbcef77"
        }
      ],
      "history": [
        [
          "2026/11/12 11:05:00",
          "CREATE",
          "Audit logistics_field_operator",
          "CO-PREP-261112-02"
        ],
        [
          "2026/11/12 11:05:00",
          "提交",
          "Audit logistics_field_operator",
          "CO-PREP-261112-02"
        ],
        [
          "2026/11/12 11:05:00",
          "现场审核通过",
          "Audit site_supervisor",
          "CO-PREP-261112-02"
        ],
        [
          "2026/11/12 11:05:00",
          "最终入库审批",
          "Audit production_manager",
          "CO-PREP-261112-02"
        ],
        [
          "2026/11/12 11:05:00",
          "更新袋级记录",
          "Audit logistics_field_operator",
          "CO-PREP-261112-02"
        ],
        [
          "2026/11/12 11:05:00",
          "保存检斤与备货资料",
          "Audit logistics_field_operator",
          "CO-PREP-261112-02"
        ]
      ],
      "archive": [
        {
          "title": "批次标识",
          "fields": [
            [
              "备货批次号",
              "RMM-CO-2026-202"
            ],
            [
              "入库备货单号",
              "CO-PREP-261112-02"
            ],
            [
              "客户",
              null
            ],
            [
              "实际入库时间",
              "2026/11/12 11:05:00"
            ],
            [
              "来源",
              "入库备货单与关联销售计划"
            ]
          ]
        },
        {
          "title": "库存与重量",
          "fields": [
            [
              "货位",
              null
            ],
            [
              "吨包袋数",
              2
            ],
            [
              "实物净重（MT）",
              "1.3041"
            ],
            [
              "预计钴金属量（MT）",
              "0.46949"
            ],
            [
              "ARECOMS 实际确认量（MT）",
              null
            ],
            [
              "来源",
              "库存批次汇总、袋级检斤和正式出库确认"
            ]
          ]
        }
      ]
    },
    {
      "id": "e39c2082-13c3-4f74-9e09-0794e605675b",
      "kind": "outbound",
      "scenario": "已正式出库批次",
      "code": "RMM-CO-2026-211",
      "status": "已正式出库",
      "location": null,
      "bags": 1,
      "net": "0.6471",
      "grade": null,
      "estimated": "0.23296",
      "confirmed": "0.35641",
      "units": [
        [
          "MUS-CO-261112-006",
          "RC2-SEAL-6df4501f",
          "650.1230",
          "647.1230",
          "已取样",
          "已正式出库"
        ]
      ],
      "docs": [
        {
          "kind": "备货计划",
          "code": "RMM-CO-2026-211",
          "at": "2026/11/12 11:05:18",
          "status": "已审批",
          "href": "/preparation/work-plans/d5d1baa5-c391-4f1a-9aba-12b890b5f329"
        },
        {
          "kind": "入库备货单",
          "code": "CO-PREP-261112-03",
          "at": "2026/11/12 11:05:18",
          "status": "已入库",
          "href": "/receipts/e39c2082-13c3-4f74-9e09-0794e605675b"
        },
        {
          "kind": "销售计划",
          "code": "CO-SP-03",
          "at": "2026/11/12 11:05:18",
          "status": "执行中",
          "href": "/sales-plans/3dd265e8-a585-41d1-bb3a-c2a270aa3bb1"
        },
        {
          "kind": "装车计划",
          "code": "CO-LP-01",
          "at": "2026-11-12",
          "status": "已正式出库",
          "href": "/loading-plans/orders/a60c3408-7384-4ac7-adf0-09476eb8400a"
        },
        {
          "kind": "正式出库装车单",
          "code": "LOAD-20261112-02",
          "at": "2026/11/12 11:05:18",
          "status": "已正式出库",
          "href": "/outbounds/0c64e429-467a-4f1d-936a-ae3212fb84e7"
        },
        {
          "kind": "装箱单",
          "code": "RMM-CO-6df4501f-01-PL",
          "at": "2026/11/12 11:05:19",
          "status": "已归档",
          "href": "/outbounds/0c64e429-467a-4f1d-936a-ae3212fb84e7/packing-list"
        }
      ],
      "history": [
        [
          "2026/11/12 11:05:18",
          "CREATE",
          "Audit logistics_field_operator",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "提交",
          "Audit logistics_field_operator",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "更新袋级记录",
          "Audit logistics_field_operator",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "保存检斤与备货资料",
          "Audit logistics_field_operator",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "提交完工审核",
          "Audit logistics_field_operator",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "提交完工审核",
          "Audit logistics_field_operator",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "完工审核通过",
          "Audit site_supervisor",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "完工审核通过",
          "Audit site_supervisor",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "最终入库审批",
          "Audit production_manager",
          "CO-PREP-261112-03"
        ],
        [
          "2026/11/12 11:05:18",
          "装车",
          "Audit logistics_field_operator",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "REVIEW_PENDING",
          "Audit logistics_field_operator",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "完成装车",
          "Audit site_supervisor",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "实际离场",
          "Audit logistics_field_operator",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "提交正式出库",
          "Audit logistics_field_operator",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "物流出库审批通过",
          "Audit logistics_manager",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "已正式出库",
          "Audit production_manager",
          "LOAD-20261112-02"
        ],
        [
          "2026/11/12 11:05:18",
          "FORMAL_OUTBOUND CO-OUT-01",
          "Audit production_manager",
          "MUS-CO-261112-006"
        ],
        [
          "2026/11/12 11:05:18",
          "备货货位安排（系统记录）",
          "Audit site_supervisor",
          "MUS-CO-261112-006"
        ]
      ],
      "archive": [
        {
          "title": "批次标识",
          "fields": [
            [
              "备货批次号",
              "RMM-CO-2026-211"
            ],
            [
              "入库备货单号",
              "CO-PREP-261112-03"
            ],
            [
              "客户",
              "Synthetic CO-AUDIT"
            ],
            [
              "实际入库时间",
              "2026/11/12 11:05:18"
            ],
            [
              "来源",
              "入库备货单与关联销售计划"
            ]
          ]
        },
        {
          "title": "库存与重量",
          "fields": [
            [
              "货位",
              null
            ],
            [
              "吨包袋数",
              1
            ],
            [
              "实物净重（MT）",
              "0.6471"
            ],
            [
              "预计钴金属量（MT）",
              "0.23296"
            ],
            [
              "ARECOMS 实际确认量（MT）",
              "0.35641"
            ],
            [
              "来源",
              "库存批次汇总、袋级检斤和正式出库确认"
            ]
          ]
        }
      ]
    }
  ]
};
