import { describe, expect, it } from 'vitest';

import {
  buildEmptyAgentWorldbookSnapshot_ACU,
  renderAgentWorldbookCatalog_ACU,
  renderAgentWorldbookEntries_ACU,
  renderAgentWorldbookHits_ACU,
  type AgentWorldbookSnapshot_ACU,
} from '../../../../src/service/continuation/agent/agent-worldbook-read';

function snapshot_ACU(): AgentWorldbookSnapshot_ACU {
  return {
    available: true,
    entries: [
      { bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑', '禁区'], constant: false, content: '黑色晶屑是禁区核心的碎片。', tokens: 18 },
      { bookName: '设定集', uid: '9', title: '守门人', keys: [], constant: true, content: '守门人世代驻守铁门。', tokens: 12 },
    ],
  };
}

describe('世界书目录渲染', () => {
  it('每条一行：标题、关键词、10 字摘要、token 估算与精读地址', () => {
    const catalog = renderAgentWorldbookCatalog_ACU(snapshot_ACU());
    expect(catalog).toContain('晶屑设定｜关键词：晶屑、禁区');
    expect(catalog).toContain('守门人｜关键词：（无）');
    expect(catalog).toContain('摘要：黑色晶屑是禁区核心的');
    expect(catalog).toContain('约 18 token');
    expect(catalog).toContain('$WORLDBOOK:设定集:7');
    expect(catalog).toContain('$WORLDBOOK:设定集:9');
    // 目录只有标题与元信息，不注入条目全文。
    expect(catalog).not.toContain('黑色晶屑是禁区核心的碎片。');
  });

  it('读取失败与空快照分别如实标注，不混为一谈', () => {
    expect(renderAgentWorldbookCatalog_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false))).toContain('目录不可用');
    expect(renderAgentWorldbookCatalog_ACU(buildEmptyAgentWorldbookSnapshot_ACU(true))).toContain('当前没有已启用的世界书条目');
  });
});

describe('世界书命中提示', () => {
  it('常开条目始终命中，关键词条目按扫描文本包含匹配命中', () => {
    const hits = renderAgentWorldbookHits_ACU(snapshot_ACU(), '主角捡起一枚晶屑端详。');
    expect(hits).toContain('晶屑设定（关键词命中｜约 18 token）');
    expect(hits).toContain('守门人（常开｜约 12 token）');
    expect(hits).toContain('$WORLDBOOK:设定集:7');
  });

  it('无关键词命中时只列常开条目；全无命中与不可用分别如实说明', () => {
    const onlyConstant = renderAgentWorldbookHits_ACU(snapshot_ACU(), '与设定无关的日常对话。');
    expect(onlyConstant).toContain('守门人（常开');
    expect(onlyConstant).not.toContain('晶屑设定');

    const noConstant: AgentWorldbookSnapshot_ACU = {
      available: true,
      entries: [{ bookName: '设定集', uid: '7', title: '晶屑设定', keys: ['晶屑'], constant: false, content: 'x', tokens: 1 }],
    };
    expect(renderAgentWorldbookHits_ACU(noConstant, '无关文本')).toContain('没有命中任何世界书条目');
    expect(renderAgentWorldbookHits_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false), '晶屑')).toContain('无法给出命中提示');
  });
});

describe('世界书条目精读', () => {
  it('按书名 + uid 返回全文，未知 uid 如实列出', () => {
    const text = renderAgentWorldbookEntries_ACU(snapshot_ACU(), '设定集', ['7', '99']);
    expect(text).toContain('黑色晶屑是禁区核心的碎片。');
    expect(text).toContain('以下 uid 不存在于「设定集」的已启用条目中：99');
  });

  it('未知书名、地址不完整与读取失败都回灌可修正的错误文本', () => {
    expect(renderAgentWorldbookEntries_ACU(snapshot_ACU(), '不存在的书', ['7'])).toContain('不存在世界书「不存在的书」');
    expect(renderAgentWorldbookEntries_ACU(snapshot_ACU(), '', [])).toContain('地址不完整');
    expect(renderAgentWorldbookEntries_ACU(buildEmptyAgentWorldbookSnapshot_ACU(false), '设定集', ['7'])).toContain('读取失败');
  });
});
