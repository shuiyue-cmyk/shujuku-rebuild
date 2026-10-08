<template>
  <div class="ub-cm">
    <div class="ub-cm__bar">
      <UbSegmented v-model="activeTab" :options="TABS" aria-label="资料类别" size="sm" />
      <span class="ub-cm__spacer"></span>
      <UbButton size="sm" variant="ghost" icon="fa-solid fa-rotate" :busy="busy" @click="reload">刷新</UbButton>
      <UbButton size="sm" variant="danger" icon="fa-solid fa-trash-can" :busy="busy" @click="clearPending = true">一键清空</UbButton>
    </div>

    <div v-if="clearPending" class="ub-cm__confirm" role="alert">
      <p>
        清空会删除当前续写任务、主 Agent 的会话记录与本地资料快照（伏笔、信息差、长期约束、故事总纲、年代学、百科资料库、用户要求）。
        小说正文楼层不受影响，清空后可以从当前剧情重新开始规划。
      </p>
      <div class="ub-cm__actions">
        <UbButton size="sm" variant="ghost" @click="clearPending = false">取消</UbButton>
        <UbButton size="sm" variant="danger" :busy="busy" @click="confirmClear">确认清空</UbButton>
      </div>
    </div>

    <!-- 阶段大纲 -->
    <div v-if="activeTab === 'outline'" class="ub-cm__pane">
      <p v-if="!task" class="ub-cm__empty">还没有续写任务，也就没有阶段大纲。</p>
      <template v-else>
        <template v-if="activeRevision && activeStage">
          <div class="ub-cm__hero">
            <div class="ub-cm__hero-title">
              第 {{ activeStage.stageNumber }} 阶段：{{ activeRevision.outline.title }}
            </div>
            <div class="ub-cm__tags">
              <UbBadge variant="accent">{{ TEMPO_LABELS[activeRevision.outline.tempo] ?? activeRevision.outline.tempo }}</UbBadge>
              <UbBadge>职责：{{ ROLE_LABELS[activeRevision.outline.role ?? ''] ?? activeRevision.outline.role ?? '未标注' }}</UbBadge>
              <UbBadge>revision {{ activeRevision.revision }}</UbBadge>
              <UbBadge :variant="activeRevision.frozen ? 'success' : 'warning'">{{ activeRevision.frozen ? '已冻结' : '待确认' }}</UbBadge>
            </div>
            <p class="ub-cm__body">阶段目标：{{ activeRevision.outline.goal }}</p>
            <p class="ub-cm__meta">故事时间目标：{{ activeRevision.outline.timeSpanGoal ?? '未设定' }}</p>
            <div class="ub-cm__progress" :title="`完成 ${activeStage.completedTurns} / ${activeRevision.outline.totalTurns} 轮`">
              <span :style="{ width: `${progressPercent(activeStage, activeRevision)}%` }"></span>
            </div>
            <p class="ub-cm__meta">
              完成 {{ activeStage.completedTurns }} / {{ activeRevision.outline.totalTurns }} 轮 · 剩余 {{ remainingTurns(activeStage, activeRevision) }} 轮 ·
              所属 active 卷：{{ activeVolume ? `[${activeVolume.id}]「${activeVolume.title}」` : '未识别（故事总纲尚未加载或当前没有 active 卷）' }}
            </p>
            <p class="ub-cm__meta">已完成轮次与正在执行的轮次不可删除或替换，总轮数必须留在阶段规模范围内。</p>
          </div>

          <section v-for="(node, nodeIndex) in activeRevision.outline.nodes" :key="node.id" class="ub-cm__node">
            <div class="ub-cm__node-head">
              <strong>{{ node.title }}</strong>
              <UbBadge>{{ node.turns.length }} 轮</UbBadge>
            </div>
            <p class="ub-cm__body">节点目标：{{ node.goal }}</p>
            <ol class="ub-cm__turns">
              <li v-for="(turn, turnIndex) in node.turns" :key="turn.id" :class="`is-${turnState(activeRevision, nodeIndex, turnIndex)}`">
                <span class="ub-cm__turn-goal">第 {{ turnPosition(activeRevision, node.id, turnIndex) }} 轮 · {{ turn.goal }}</span>
                <span class="ub-cm__tags">
                  <UbBadge v-if="turnState(activeRevision, nodeIndex, turnIndex) === 'current'" variant="accent">当前执行</UbBadge>
                  <UbBadge>{{ PACING_LABELS[turn.pacing] ?? turn.pacing }}</UbBadge>
                  <UbBadge>功能：{{ FUNCTION_LABELS[turn.function ?? ''] ?? turn.function ?? '未标注' }}</UbBadge>
                  <UbBadge>主线：{{ MAINLINE_LABELS[turn.mainlineDelta ?? ''] ?? turn.mainlineDelta ?? '未标注' }}</UbBadge>
                  <UbBadge>时间：{{ TIME_LABELS[turn.timeAdvance ?? ''] ?? turn.timeAdvance ?? '未标注' }}<template v-if="turn.timeAnchor"> · {{ turn.timeAnchor }}</template></UbBadge>
                  <UbBadge v-if="turn.inferred?.length" variant="warning">系统补全：{{ turn.inferred.map(field => INFERRED_FIELD_LABELS[field] ?? field).join('、') }}</UbBadge>
                </span>
              </li>
            </ol>
          </section>

          <JsonDraftEditor
            :draft="outlineDraft"
            :dirty="outlineDirty"
            :saving="busy"
            :error="outlineError || (outlineStale ? OUTLINE_STALE_MESSAGE : '')"
            save-label="保存大纲"
            :rows="16"
            hint="改轮次目标时请同步核对 pacing、function、mainlineDelta、timeAdvance 与 timeAnchor；缺少的语义字段保存时按 pacing 补默认并标注「系统补全」。"
            @update="onOutlineInput"
            @discard="syncOutlineDraft"
            @save="saveOutline"
          />
        </template>
        <p v-else class="ub-cm__empty">当前没有已冻结的阶段大纲可编辑。</p>

        <details
          v-for="stage in historyStages"
          :key="stage.stageId"
          class="ub-cm__history"
          :open="expandedHistoryStages.has(stage.stageId)"
          @toggle="toggleHistoryStage(stage, $event)"
        >
          <summary>第 {{ stage.stageNumber }} 阶段 · {{ stage.status }} · {{ stage.completedTurns }} / {{ stageTotalTurns(stage) }} 轮</summary>
          <template v-if="expandedHistoryStages.has(stage.stageId)">
            <template v-for="revision in [displayRevision(stage)]" :key="revision?.revision ?? 'no-revision'">
              <div v-if="revision" class="ub-cm__history-body">
                <div class="ub-cm__node-head">
                  <strong>{{ revision.outline.title }}</strong>
                  <UbBadge>revision {{ revision.revision }}</UbBadge>
                  <UbBadge>{{ revision.frozen ? '已冻结' : '待确认' }}</UbBadge>
                  <UbBadge>职责：{{ ROLE_LABELS[revision.outline.role ?? ''] ?? revision.outline.role ?? '未标注' }}</UbBadge>
                </div>
                <p class="ub-cm__body">阶段目标：{{ revision.outline.goal }}</p>
                <ol class="ub-cm__list">
                  <li v-for="node in revision.outline.nodes" :key="node.id">
                    <strong>{{ node.title }}</strong>：{{ node.goal }}
                    <ol>
                      <li v-for="turn in node.turns" :key="turn.id">
                        {{ turn.goal }} · {{ PACING_LABELS[turn.pacing] ?? turn.pacing }} · {{ FUNCTION_LABELS[turn.function ?? ''] ?? turn.function ?? '未标注' }} · 主线 {{ MAINLINE_LABELS[turn.mainlineDelta ?? ''] ?? turn.mainlineDelta ?? '未标注' }} · {{ TIME_LABELS[turn.timeAdvance ?? ''] ?? turn.timeAdvance ?? '未标注' }}<template v-if="turn.timeAnchor">（{{ turn.timeAnchor }}）</template>
                      </li>
                    </ol>
                  </li>
                </ol>
              </div>
              <p v-else class="ub-cm__empty">该阶段没有可展示的 revision。</p>
            </template>
            <details v-if="olderRevisions(stage).length" class="ub-cm__history ub-cm__history--inner">
              <summary>旧 revision（{{ olderRevisions(stage).length }}）</summary>
              <details v-for="revision in olderRevisions(stage)" :key="revision.revision" class="ub-cm__history ub-cm__history--inner">
                <summary>revision {{ revision.revision }} · {{ revision.reason }} · {{ revision.outline.title }}</summary>
                <ol class="ub-cm__list">
                  <li v-for="node in revision.outline.nodes" :key="node.id"><strong>{{ node.title }}</strong>：{{ node.goal }}</li>
                </ol>
              </details>
            </details>
          </template>
        </details>
      </template>
    </div>

    <!-- 本地资料 -->
    <div v-else-if="activeTab === 'modules'" class="ub-cm__pane">
      <p class="ub-cm__meta">
        本地资料由子代理结算写入，也可在这里分模块手动修正。保存走与子代理相同的结构校验并推进修订号；每个模块独立保存，只提交本模块数据。
      </p>

      <div class="ub-cm__status-grid">
        <article v-for="card in materialStatusCards" :key="card.module" class="ub-cm__status" :class="{ 'is-bad': card.state === 'pending' || card.state === 'load_failed' }">
          <div class="ub-cm__node-head">
            <strong>{{ materialStatusTitle(card.module) }}</strong>
            <UbBadge :variant="card.state === 'pending' || card.state === 'load_failed' ? 'danger' : 'neutral'">{{ card.label }}</UbBadge>
          </div>
          <p class="ub-cm__meta">{{ card.detail }}</p>
        </article>
      </div>

      <section v-if="repairableModules.length" class="ub-cm__box">
        <div class="ub-cm__box-title">定向补足</div>
        <p class="ub-cm__meta">只开放所选待补模块的程序级写集；已完成模块不会被重写。历史状态未知的模块必须在此显式选择。</p>
        <div class="ub-cm__checks">
          <UbCheck
            v-for="module in repairableModules"
            :key="module"
            :model-value="selectedRepairModules.includes(module)"
            :label="MATERIAL_STATUS_LABELS[module] ?? module"
            :disabled="busy"
            @update:model-value="toggleRepairModule(module)"
          />
        </div>
        <div class="ub-cm__actions">
          <UbButton size="sm" variant="primary" icon="fa-solid fa-screwdriver-wrench" :busy="busy" :disabled="!selectedRepairModules.length" @click="requestRepair">补足所选模块</UbButton>
        </div>
      </section>

      <section v-if="pendingFixCards.length" class="ub-cm__box is-warn">
        <div class="ub-cm__box-title">待修复</div>
        <article v-for="card in pendingFixCards" :key="card.module" class="ub-cm__fix">
          <div class="ub-cm__node-head"><strong>{{ card.title }}</strong><UbBadge variant="warning">第 {{ card.attempts }} 次</UbBadge></div>
          <p class="ub-cm__body">{{ card.detail }}</p>
          <p class="ub-cm__meta">{{ card.meta }}</p>
        </article>
      </section>

      <template v-if="materials.snapshot.value">
        <p class="ub-cm__meta">
          结算水位：楼层 {{ materials.snapshot.value.settledThroughIndex }} ·
          伏笔 {{ materials.snapshot.value.hooks.length }} · 信息差 {{ materials.snapshot.value.infoGap.length }} ·
          长期约束 {{ materials.snapshot.value.constraints.length }} · 故事时间 {{ materials.snapshot.value.chronology.length }} ·
          修订号 {{ materials.snapshot.value.revisions.hooks }}/{{ materials.snapshot.value.revisions.infoGap }}/{{ materials.snapshot.value.revisions.constraints }}/{{ materials.snapshot.value.revisions.chronology }}
        </p>
        <p class="ub-cm__meta">
          <template v-if="materials.diagnostics.value.adoptedIndex === null">
            当前聊天没有任何楼层带有资料快照。快照由子代理结算后写到当时的末楼并跟着该楼层走：该楼被删除、重新生成或 swipe 时，资料会回退到更早楼层的快照；若此前只写过一次，就会回到空。
          </template>
          <template v-else>
            资料来源：楼层 {{ materials.diagnostics.value.adoptedIndex }}<template v-if="materials.diagnostics.value.salvaged">（该楼快照未通过严格校验，已按宽容模式读取，损坏记录已丢弃）</template>。
            <template v-if="invalidCandidates.length">
              另有 {{ invalidCandidates.length }} 个楼层的快照结构损坏被跳过：
              <span v-for="item in invalidCandidates" :key="item.index">楼层 {{ item.index }}（{{ item.problems.slice(0, 3).join('；') }}）；</span>
            </template>
          </template>
        </p>
      </template>
      <p v-if="materials.loadError.value" class="ub-cm__error">{{ materials.loadError.value }}</p>

      <details class="ub-cm__history">
        <summary>逐栏记录 · {{ fieldRecordTotal }} 条</summary>
        <p class="ub-cm__meta">「部分」条目还没写齐必填栏，不进入完整资料；「旧快照条目」来自旧整条快照，来源不可逐栏拆分。这里只列栏目名与修订身份。</p>
        <p v-if="!fieldRecordGroups.length" class="ub-cm__empty">还没有逐栏写入记录。</p>
        <details v-for="group in fieldRecordGroups" :key="group.module" class="ub-cm__history ub-cm__history--inner">
          <summary>{{ group.label }} · {{ group.records.length }} 条</summary>
          <div class="ub-cm__cards">
            <div v-for="record in group.records" :key="record.id" class="ub-cm__card">
              <div class="ub-cm__node-head">
                <strong>{{ record.id }}</strong>
                <UbBadge :variant="record.status === 'complete' ? 'success' : 'neutral'">{{ FIELD_STATUS_LABELS[record.status] ?? record.status }}</UbBadge>
              </div>
              <p class="ub-cm__meta">已写字段：{{ record.fieldNames.join('、') || '（无）' }}</p>
              <p v-if="record.missingFields.length" class="ub-cm__meta">缺栏：{{ record.missingFields.join('、') }}</p>
              <p class="ub-cm__meta">最近更新 {{ formatTimestamp(record.updatedAt) }}<template v-if="record.maxRevision > 0"> · 栏目修订号最高 {{ record.maxRevision }}</template></p>
            </div>
          </div>
        </details>
      </details>

      <section class="ub-cm__module">
        <div class="ub-cm__module-head">伏笔账本 <span>{{ materials.snapshot.value?.hooks.length ?? 0 }} 条</span></div>
        <p v-if="!materials.snapshot.value?.hooks.length" class="ub-cm__empty">还没有伏笔条目。</p>
        <div v-else class="ub-cm__cards">
          <div v-for="hook in materials.snapshot.value.hooks" :key="hook.id" class="ub-cm__card" :class="{ 'is-retired': hook.retired }">
            <div class="ub-cm__node-head">
              <strong>{{ hook.id }}</strong>
              <UbBadge variant="accent">{{ HOOK_STATUS_LABELS[hook.status] ?? hook.status }}</UbBadge>
              <UbBadge>{{ HOOK_IMPORTANCE_LABELS[hook.importance] ?? hook.importance }}</UbBadge>
              <UbBadge v-if="hook.retired">已退休{{ hook.retiredReason ? `：${hook.retiredReason}` : '' }}</UbBadge>
            </div>
            <p class="ub-cm__body">{{ hook.summary }}</p>
            <p class="ub-cm__meta">植入楼层 {{ hook.plantedIndex }} · 最近更新楼层 {{ hook.updatedIndex }}<template v-if="hook.plannedPayoff"> · 计划回收：{{ hook.plannedPayoff }}</template></p>
          </div>
        </div>
        <JsonDraftEditor v-bind="editorProps('hooks', '保存伏笔账本')" @update="v => materials.updateDraft('hooks', v)" @discard="materials.discard('hooks')" @save="materials.save('hooks')" />
      </section>

      <section class="ub-cm__module">
        <div class="ub-cm__module-head">认知与信息差 <span>{{ materials.snapshot.value?.infoGap.length ?? 0 }} 条</span></div>
        <p v-if="!materials.snapshot.value?.infoGap.length" class="ub-cm__empty">还没有信息差条目。</p>
        <div v-else class="ub-cm__cards">
          <div v-for="gap in materials.snapshot.value.infoGap" :key="gap.id" class="ub-cm__card" :class="{ 'is-retired': gap.retired }">
            <div class="ub-cm__node-head">
              <strong>{{ gap.id }}</strong>
              <span class="ub-cm__body">{{ gap.topic }}</span>
              <UbBadge variant="accent">{{ REVEAL_STATUS_LABELS[gap.revealStatus] ?? gap.revealStatus }}</UbBadge>
              <UbBadge v-if="gap.revealIndex !== null">揭示楼层 {{ gap.revealIndex }}</UbBadge>
              <UbBadge v-if="gap.retired">已退休{{ gap.retiredReason ? `：${gap.retiredReason}` : '' }}</UbBadge>
            </div>
            <p class="ub-cm__body">客观事实：{{ gap.objectiveFact }}</p>
            <p class="ub-cm__meta">读者已知：{{ gap.readerKnown || '（未记录）' }}</p>
            <p v-for="knowledge in gap.characterKnowledge" :key="knowledge.name" class="ub-cm__meta">{{ knowledge.name }} 知道：{{ knowledge.knows }}</p>
          </div>
        </div>
        <JsonDraftEditor v-bind="editorProps('infoGap', '保存信息差')" @update="v => materials.updateDraft('infoGap', v)" @discard="materials.discard('infoGap')" @save="materials.save('infoGap')" />
      </section>

      <section class="ub-cm__module">
        <div class="ub-cm__module-head">长期约束 <span>{{ materials.snapshot.value?.constraints.length ?? 0 }} 条</span></div>
        <p v-if="!materials.snapshot.value?.constraints.length" class="ub-cm__empty">还没有长期约束。</p>
        <div v-else class="ub-cm__cards">
          <div v-for="constraint in materials.snapshot.value.constraints" :key="constraint.id" class="ub-cm__card">
            <div class="ub-cm__node-head"><strong>{{ constraint.id }}</strong></div>
            <p class="ub-cm__body">{{ constraint.text }}</p>
            <p class="ub-cm__meta">登记楼层 {{ constraint.createdIndex }}<template v-if="constraint.reason"> · 缘由：{{ constraint.reason }}</template></p>
          </div>
        </div>
        <JsonDraftEditor v-bind="editorProps('constraints', '保存长期约束', 10)" @update="v => materials.updateDraft('constraints', v)" @discard="materials.discard('constraints')" @save="materials.save('constraints')" />
      </section>

      <section class="ub-cm__module">
        <div class="ub-cm__module-head">故事年代学账本 <span>{{ materials.snapshot.value?.chronology.length ?? 0 }} 条</span></div>
        <p v-if="!materials.snapshot.value?.chronology.length" class="ub-cm__empty">还没有已结算的故事时间记录。时间事实由结算维护代理依据真实正文登记；大纲里的时间字段是计划。</p>
        <div v-else class="ub-cm__cards">
          <div v-for="entry in materials.snapshot.value.chronology" :key="entry.id" class="ub-cm__card" :class="{ 'is-retired': entry.retired }">
            <div class="ub-cm__node-head">
              <strong>{{ entry.id }}</strong>
              <span class="ub-cm__body">{{ entry.anchor }}</span>
              <UbBadge>{{ CHRONOLOGY_PRECISION_LABELS[entry.precision] ?? entry.precision }}</UbBadge>
              <UbBadge v-if="entry.retired">已作废{{ entry.retiredReason ? `：${entry.retiredReason}` : '' }}</UbBadge>
            </div>
            <p class="ub-cm__body">累计经过：{{ entry.elapsed }}</p>
            <p class="ub-cm__body">时间转换：{{ entry.transition }}</p>
            <p class="ub-cm__meta">证据楼层 {{ entry.evidenceIndexes.join('、') }} · 结算楼层 {{ entry.updatedIndex }}</p>
          </div>
        </div>
        <JsonDraftEditor v-bind="editorProps('chronology', '保存年代学账本', 10)" @update="v => materials.updateDraft('chronology', v)" @discard="materials.discard('chronology')" @save="materials.save('chronology')" />
      </section>
    </div>

    <!-- 故事总纲 -->
    <div v-else-if="activeTab === 'storyArc'" class="ub-cm__pane">
      <p class="ub-cm__meta">故事总纲由 arc-architect 子代理维护：全书方向一条 + 若干卷台阶。也可在这里手动修正，保存走同一套结构校验并推进修订号。</p>
      <p v-if="materials.snapshot.value" class="ub-cm__meta">总纲 {{ materials.snapshot.value.storyArc.length }} 条 · 修订号 {{ materials.snapshot.value.revisions.storyArc }}</p>
      <p v-if="materials.loadError.value" class="ub-cm__error">{{ materials.loadError.value }}</p>
      <p v-if="!materials.snapshot.value?.storyArc.length" class="ub-cm__empty">还没有故事总纲。开始规划后主 Agent 会先派工 arc-architect 立总纲。</p>
      <div v-else class="ub-cm__cards">
        <div v-for="arc in materials.snapshot.value.storyArc" :key="arc.id" class="ub-cm__card" :class="{ 'is-retired': arc.retired }">
          <div class="ub-cm__node-head">
            <strong>{{ arc.id }}</strong>
            <UbBadge variant="accent">{{ arc.scope === 'story' ? '全书方向' : '卷台阶' }}</UbBadge>
            <UbBadge>{{ ARC_STATUS_LABELS[arc.status] ?? arc.status }}</UbBadge>
            <span class="ub-cm__body">{{ arc.title }}</span>
            <UbBadge v-if="arc.retired">已退休{{ arc.retiredReason ? `：${arc.retiredReason}` : '' }}</UbBadge>
          </div>
          <p class="ub-cm__body">方向：{{ arc.direction }}</p>
          <p v-if="arc.escalation" class="ub-cm__body">冲突高度：{{ arc.escalation }}</p>
          <p v-if="arc.withheld" class="ub-cm__meta">禁翻底牌：{{ arc.withheld }}</p>
          <p class="ub-cm__meta">已承载阶段：{{ arc.stageNumbers.length ? arc.stageNumbers.join('、') : '（尚未承载）' }}</p>
        </div>
      </div>
      <JsonDraftEditor v-bind="editorProps('storyArc', '保存故事总纲', 14)" @update="v => materials.updateDraft('storyArc', v)" @discard="materials.discard('storyArc')" @save="materials.save('storyArc')" />
    </div>

    <!-- 百科资料 -->
    <div v-else-if="activeTab === 'webRefs'" class="ub-cm__pane">
      <p class="ub-cm__meta">
        百科资料库由 web-researcher 子代理从萌娘百科、维基百科或 SearXNG 查到后写入，按实体分条。每条固定只有「名称 + 一句话简介」，详情自由格式。
        它记录的是原作/公开设定，不是本故事已发生的事实；与世界书或正文冲突时以后者为准。
      </p>
      <p v-if="materials.snapshot.value" class="ub-cm__meta">
        条目 {{ materials.snapshot.value.webRefs.length }} 条（活跃 {{ materials.snapshot.value.webRefs.filter(entry => !entry.retired).length }}）· 修订号 {{ materials.snapshot.value.revisions.webRefs }}
      </p>
      <p v-if="materials.loadError.value" class="ub-cm__error">{{ materials.loadError.value }}</p>
      <p v-if="!materials.snapshot.value?.webRefs.length" class="ub-cm__empty">还没有百科资料。在续写设置里打开「开场百科检索」后，新任务第一次规划前会自动检索；主 Agent 之后也可按需派工 web-researcher。</p>
      <div v-else class="ub-cm__cards">
        <details v-for="ref in materials.snapshot.value.webRefs" :key="ref.id" class="ub-cm__card" :class="{ 'is-retired': ref.retired }">
          <summary class="ub-cm__node-head">
            <strong>{{ ref.id }}</strong>
            <span class="ub-cm__body">{{ ref.title }}</span>
            <UbBadge variant="accent">{{ WEB_REF_SOURCE_LABELS[ref.source] ?? ref.source }}</UbBadge>
            <UbBadge v-for="tag in ref.tags" :key="tag">{{ tag }}</UbBadge>
            <UbBadge v-if="ref.sourceStatus !== 'ok'" variant="warning">{{ WEB_REF_STATUS_LABELS[ref.sourceStatus] ?? ref.sourceStatus }}</UbBadge>
            <UbBadge v-if="ref.retired">已退休{{ ref.retiredReason ? `：${ref.retiredReason}` : '' }}</UbBadge>
          </summary>
          <p class="ub-cm__body">{{ ref.brief }}</p>
          <p v-if="ref.summary" class="ub-cm__body">{{ ref.summary }}</p>
          <p class="ub-cm__meta">
            <a :href="ref.url" target="_blank" rel="noopener noreferrer">{{ ref.url }}</a>
            <template v-if="ref.query"> · 检索词：{{ ref.query }}</template>
            <template v-if="ref.fetchedAt"> · 抓取于 {{ new Date(ref.fetchedAt).toLocaleString() }}</template>
          </p>
        </details>
      </div>
      <JsonDraftEditor
        v-bind="editorProps('webRefs', '保存百科资料库', 14)"
        hint="每条至少需要 id、title（名称）、url、brief（一句话简介）；summary 为自由格式详情，tags 可选。网页原文不保存。手动新增的条目 source 可写 web。"
        @update="v => materials.updateDraft('webRefs', v)"
        @discard="materials.discard('webRefs')"
        @save="materials.save('webRefs')"
      />
    </div>

    <!-- 用户要求 -->
    <div v-else-if="activeTab === 'userRequirements'" class="ub-cm__pane">
      <p class="ub-cm__meta">用户要求由 requirements-maintainer 在会话历史压缩后整理，创建任务时会把初始要求写成首条；每个标签是一条要求。</p>
      <p v-if="materials.snapshot.value" class="ub-cm__meta">条目 {{ materials.snapshot.value.userRequirements.length }} 条 · 修订号 {{ materials.snapshot.value.revisions.userRequirements }}</p>
      <p v-if="materials.loadError.value" class="ub-cm__error">{{ materials.loadError.value }}</p>
      <p v-if="materials.snapshot.value && !materials.snapshot.value.userRequirements.length" class="ub-cm__empty">
        还没有用户要求条目。创建任务后会写入初始要求；之后在会话里补充的实质要求会在历史压缩后合并进来。也可以手动新增。
      </p>
      <div class="ub-cm__reqs">
        <div v-for="(item, index) in requirementItems" :key="index" class="ub-cm__req">
          <span class="ub-cm__req-index">{{ index + 1 }}</span>
          <UbTextarea
            :model-value="item"
            :rows="2"
            auto-resize
            :max-rows="8"
            :disabled="requirementsDisabled"
            placeholder="输入一条用户要求"
            :aria-label="`要求 ${index + 1}`"
            @update:model-value="updateRequirement(index, $event)"
          />
          <UbIconButton icon="fa-solid fa-trash-can" variant="danger" size="sm" title="删除标签" :disabled="requirementsDisabled" @click="removeRequirement(index)" />
        </div>
      </div>
      <div class="ub-cm__actions">
        <UbButton size="sm" variant="ghost" icon="fa-solid fa-plus" :disabled="requirementsDisabled" @click="updateRequirementItems([...requirementItems, ''])">新增标签</UbButton>
        <span class="ub-cm__spacer"></span>
        <UbButton size="sm" variant="ghost" :disabled="requirementsDisabled || !materials.modules.userRequirements.dirty" @click="materials.discard('userRequirements')">放弃修改</UbButton>
        <UbButton
          size="sm"
          variant="primary"
          icon="fa-solid fa-floppy-disk"
          :busy="materials.modules.userRequirements.saving"
          :disabled="!materials.snapshot.value || busy || !materials.modules.userRequirements.dirty"
          @click="materials.save('userRequirements')"
        >
          保存用户要求
        </UbButton>
      </div>
      <p v-if="materials.modules.userRequirements.error" class="ub-cm__error" role="alert">{{ materials.modules.userRequirements.error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import { useContinuationMaterials } from '../../presentation-v2/composables/useContinuationMaterials';
import { CONTINUATION_MATERIAL_MODULE_LABELS_ACU } from '../../presentation-v2/continuation/material-module-labels';
import { buildContinuationPendingFixCards_ACU } from '../../presentation-v2/continuation/pending-fix-cards';
import { buildMaterialCompletionCards_ACU } from '../../presentation-v2/material-completion-status';
import type { AgentWritableModule_ACU } from '../../service/continuation/agent/agent-model';
import type {
  ContinuationStage_ACU,
  ContinuationTask_ACU,
  StageOutline_ACU,
  StageRevision_ACU,
} from '../../service/continuation/model';
import UbBadge from '../ui/UbBadge.vue';
import UbButton from '../ui/UbButton.vue';
import UbCheck from '../ui/UbCheck.vue';
import UbIconButton from '../ui/UbIconButton.vue';
import UbSegmented from '../ui/UbSegmented.vue';
import UbTextarea from '../ui/UbTextarea.vue';
import JsonDraftEditor from './JsonDraftEditor.vue';

type EditableModule = 'hooks' | 'infoGap' | 'constraints' | 'chronology' | 'storyArc' | 'webRefs';

const props = defineProps<{
  task: ContinuationTask_ACU | null;
  activeStage: ContinuationStage_ACU | null;
  activeRevision: StageRevision_ACU | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  (event: 'save-outline', outline: StageOutline_ACU, base: { stageId: string; revision: number } | null): void;
  (event: 'clear'): void;
  (event: 'repair', modules: AgentWritableModule_ACU[]): void;
}>();

const TABS = [
  { value: 'outline', label: '阶段大纲' },
  { value: 'modules', label: '本地资料' },
  { value: 'storyArc', label: '故事总纲' },
  { value: 'webRefs', label: '百科资料' },
  { value: 'userRequirements', label: '用户要求' },
];

const HOOK_STATUS_LABELS: Record<string, string> = { planted: '已埋设', reinforced: '已强化', misled: '已误导', partially_paid: '部分回收', paid: '已回收', abandoned: '已放弃' };
const HOOK_IMPORTANCE_LABELS: Record<string, string> = { high: '重要度：高', mid: '重要度：中', low: '重要度：低' };
const REVEAL_STATUS_LABELS: Record<string, string> = { unrevealed: '未揭示', partial: '部分揭示', revealed: '已揭示' };
const CHRONOLOGY_PRECISION_LABELS: Record<string, string> = { exact: '精确', approximate: '近似', unknown: '未知' };
const ARC_STATUS_LABELS: Record<string, string> = { planned: '计划中', active: '进行中', done: '已完成' };
const WEB_REF_SOURCE_LABELS: Record<string, string> = { moegirl: '萌娘百科', wikipedia_zh: '中文维基', wikipedia_en: '英文维基', baidu: '百度百科', web: '网页' };
const WEB_REF_STATUS_LABELS: Record<string, string> = { ok: '正常', unavailable: '来源不可用', blocked: '被拦截' };
const TEMPO_LABELS: Record<string, string> = { buildup: '铺垫型', mixed: '起伏型', surge: '高压型', aftermath: '余波型' };
const ROLE_LABELS: Record<string, string> = { setup: '建立', development: '发展', escalation: '升级', turn: '转折', payoff: '兑现', aftermath: '余波' };
const PACING_LABELS: Record<string, string> = { setup: '铺垫', pressure: '施压', turn: '转折', cooldown: '缓冲' };
const FUNCTION_LABELS: Record<string, string> = { daily_bond: '关系日常', daily_world: '世界日常', recovery: '恢复', preparation: '准备', training: '训练', economy: '经营', side_thread: '支线', conflict: '冲突', reveal: '揭示', payoff: '兑现', transition: '过渡' };
const MAINLINE_LABELS: Record<string, string> = { hold: '停驻', micro: '微增量', step: '推进', milestone: '里程碑' };
const TIME_LABELS: Record<string, string> = { continuous: '连续', same_day: '同日稍后', overnight: '隔夜', days: '数日', weeks: '数周', months: '数月', years: '数年' };
const INFERRED_FIELD_LABELS: Record<string, string> = { function: '功能', mainlineDelta: '主线', timeAdvance: '时间' };
const FIELD_STATUS_LABELS: Record<string, string> = { complete: '完整', partial: '部分（未提升）', legacy_unknown: '旧快照条目' };
const MATERIAL_STATUS_LABELS: Record<string, string> = CONTINUATION_MATERIAL_MODULE_LABELS_ACU;
const REPAIRABLE_MODULES: readonly AgentWritableModule_ACU[] = ['hooks', 'infoGap', 'chronology', 'storyArc', 'webRefs'];

const activeTab = ref('outline');
const materials = useContinuationMaterials();
const clearPending = ref(false);
const outlineDraft = ref('');
const outlineError = ref('');
const outlineDirty = ref(false);
/** R10B-07：草稿所基于的阶段与 revision；权威大纲换代后草稿即过期，不得再保存。 */
const outlineBase = ref<{ stageId: string; revision: number } | null>(null);
const OUTLINE_STALE_MESSAGE = '底稿已过期：编辑期间大纲已被更新，保存会覆盖新大纲。请放弃草稿后基于最新大纲重新编辑。';
const outlineStale = computed(() => {
  const base = outlineBase.value;
  if (!outlineDirty.value || !base) return false;
  return base.stageId !== (props.activeStage?.stageId ?? '') || base.revision !== props.activeRevision?.revision;
});
const selectedRepairModules = ref<AgentWritableModule_ACU[]>([]);
const expandedHistoryStages = ref(new Set<string>());

function editorProps(module: EditableModule, saveLabel: string, rows = 12) {
  const state = materials.modules[module];
  return { draft: state.draft, dirty: state.dirty, saving: state.saving, error: state.error, saveLabel, rows };
}

/** 逐栏记录按模块分组：只取栏目名与修订身份，不取字段值。 */
const fieldRecordGroups = computed(() => {
  const records = materials.fieldSnapshot.value.records;
  return (Object.keys(CONTINUATION_MATERIAL_MODULE_LABELS_ACU) as Array<keyof typeof CONTINUATION_MATERIAL_MODULE_LABELS_ACU>)
    .map((module) => {
      if (module === 'userRequirements') return null;
      const bucket = (records as Record<string, Record<string, { id: string; status: string; fields: Record<string, { revision: number }>; missingFields: string[]; updatedAt: number }>>)[module];
      const entries = bucket ? Object.values(bucket) : [];
      if (!entries.length) return null;
      return {
        module,
        label: CONTINUATION_MATERIAL_MODULE_LABELS_ACU[module],
        records: entries
          .map(record => ({
            id: record.id,
            status: record.status,
            fieldNames: Object.keys(record.fields),
            missingFields: record.missingFields,
            maxRevision: Object.values(record.fields).reduce((max, field) => Math.max(max, field.revision), 0),
            updatedAt: record.updatedAt,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null);
});
const fieldRecordTotal = computed(() => fieldRecordGroups.value.reduce((total, group) => total + group.records.length, 0));
const invalidCandidates = computed(() => materials.diagnostics.value.candidates.filter(item => !item.valid));

const pendingFixCards = computed(() => buildContinuationPendingFixCards_ACU(materials.snapshot.value?.pendingFixes));
const materialStatusCards = computed(() => buildMaterialCompletionCards_ACU({
  overallState: materials.snapshot.value?.materialCompletion.state,
  expectedModules: Object.keys(materials.snapshot.value?.materialCompletion.modules ?? {}),
  modules: materials.snapshot.value?.materialCompletion.modules,
  pendingModules: materials.snapshot.value?.pendingFixes.map(item => item.module),
  loadError: materials.loadError.value || null,
}));

const repairableModules = computed<AgentWritableModule_ACU[]>(() => {
  const snapshot = materials.snapshot.value;
  if (!snapshot) return [];
  const pending = new Set((snapshot.pendingFixes ?? []).map(item => item.module));
  const completion = snapshot.materialCompletion;
  const legacyOverall = !completion || completion.state === 'legacy_unknown';
  return REPAIRABLE_MODULES.filter(module => pending.has(module)
    || (completion?.modules as any)?.[module] === 'legacy_unknown'
    || legacyOverall);
});

watch(repairableModules, (modules) => {
  const allowed = new Set(modules);
  selectedRepairModules.value = selectedRepairModules.value.filter(module => allowed.has(module));
});

const requirementItems = computed<string[]>(() => {
  try {
    const parsed: unknown = JSON.parse(materials.modules.userRequirements.draft);
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
});
const requirementsDisabled = computed(() => !materials.snapshot.value || props.busy || materials.modules.userRequirements.saving);

function updateRequirementItems(items: string[]): void {
  materials.updateDraft('userRequirements', JSON.stringify(items, null, 2));
  materials.modules.userRequirements.error = '';
}

function updateRequirement(index: number, text: string): void {
  const next = [...requirementItems.value];
  next[index] = text;
  updateRequirementItems(next);
}

function removeRequirement(index: number): void {
  updateRequirementItems(requirementItems.value.filter((_item, position) => position !== index));
}

function toggleRepairModule(module: AgentWritableModule_ACU): void {
  selectedRepairModules.value = selectedRepairModules.value.includes(module)
    ? selectedRepairModules.value.filter(item => item !== module)
    : [...selectedRepairModules.value, module];
}

function requestRepair(): void {
  if (selectedRepairModules.value.length) emit('repair', [...selectedRepairModules.value]);
}

function materialStatusTitle(module: string): string {
  return module === '*' ? '资料维护状态' : MATERIAL_STATUS_LABELS[module] ?? module;
}

function formatTimestamp(value: number): string {
  return value > 0 ? new Date(value).toLocaleString() : '（未记录）';
}

const activeVolume = computed(() => materials.snapshot.value?.storyArc.find(entry => entry.scope === 'volume' && !entry.retired && entry.status === 'active') ?? null);
const historyStages = computed(() => (props.task?.stages ?? []).filter(stage => stage.stageId !== props.activeStage?.stageId));

function toggleHistoryStage(stage: ContinuationStage_ACU, event: Event): void {
  if ((event.currentTarget as HTMLDetailsElement).open) expandedHistoryStages.value.add(stage.stageId);
  else expandedHistoryStages.value.delete(stage.stageId);
}

function displayRevision(stage: ContinuationStage_ACU): StageRevision_ACU | null {
  return stage.revisions.find(revision => revision.revision === stage.activeRevision)
    ?? stage.revisions.reduce<StageRevision_ACU | null>((latest, revision) => (!latest || revision.revision > latest.revision ? revision : latest), null);
}

function olderRevisions(stage: ContinuationStage_ACU): StageRevision_ACU[] {
  const displayed = displayRevision(stage);
  return stage.revisions.filter(revision => revision.revision !== displayed?.revision).sort((left, right) => right.revision - left.revision);
}

function remainingTurns(stage: ContinuationStage_ACU, revision: StageRevision_ACU): number {
  return Math.max(0, revision.outline.totalTurns - stage.completedTurns);
}

function progressPercent(stage: ContinuationStage_ACU, revision: StageRevision_ACU): number {
  const total = revision.outline.totalTurns;
  return total > 0 ? Math.min(100, Math.round((stage.completedTurns / total) * 100)) : 0;
}

function stageTotalTurns(stage: ContinuationStage_ACU): number {
  return stage.revisions.find(item => item.revision === stage.activeRevision)?.outline.totalTurns ?? 0;
}

/** 节点内第 turnIndex 轮在整个阶段里的全局轮号（从 1 起）。 */
function turnPosition(revision: StageRevision_ACU, nodeId: string, turnIndex: number): number {
  let position = 0;
  for (const node of revision.outline.nodes) {
    if (node.id === nodeId) return position + turnIndex + 1;
    position += node.turns.length;
  }
  return position + turnIndex + 1;
}

function turnState(revision: StageRevision_ACU, nodeIndex: number, turnIndex: number): 'done' | 'current' | 'planned' {
  const stage = props.activeStage;
  if (!stage || revision.revision !== props.activeRevision?.revision) return 'planned';
  const node = revision.outline.nodes[nodeIndex];
  if (!node) return 'planned';
  if (turnPosition(revision, node.id, turnIndex) <= stage.completedTurns) return 'done';
  if (nodeIndex === stage.activeNodeIndex && turnIndex === stage.activeTurnIndex) return 'current';
  return 'planned';
}

function syncOutlineDraft(): void {
  outlineDraft.value = props.activeRevision ? JSON.stringify(props.activeRevision.outline, null, 2) : '';
  outlineBase.value = props.activeStage && props.activeRevision
    ? { stageId: props.activeStage.stageId, revision: props.activeRevision.revision }
    : null;
  outlineError.value = '';
  outlineDirty.value = false;
}

function onOutlineInput(value: string): void {
  outlineDraft.value = value;
  outlineDirty.value = true;
}

function saveOutline(): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outlineDraft.value);
  } catch (error) {
    outlineError.value = error instanceof Error ? `大纲 JSON 无法解析：${error.message}` : '大纲 JSON 无法解析';
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    outlineError.value = '大纲必须是 JSON 对象';
    return;
  }
  if (outlineStale.value) return;
  outlineError.value = '';
  emit('save-outline', parsed as StageOutline_ACU, outlineBase.value ? { ...outlineBase.value } : null);
}

function reload(): void {
  materials.reload();
  syncOutlineDraft();
}

function confirmClear(): void {
  clearPending.value = false;
  emit('clear');
}

watch(() => props.task?.taskId, () => expandedHistoryStages.value.clear());
watch(historyStages, (stages) => {
  const current = new Set(stages.map(stage => stage.stageId));
  for (const id of expandedHistoryStages.value) if (!current.has(id)) expandedHistoryStages.value.delete(id);
});
watchChatChanged_ACU(() => {
  expandedHistoryStages.value.clear();
  materials.reload();
  syncOutlineDraft();
});
/** 权威大纲变更（Agent 改写、保存成功）后重置草稿；用户正在编辑时不覆盖。 */
watch(() => `${props.activeStage?.stageId ?? ''}:${props.activeRevision?.revision ?? ''}`, () => {
  if (!outlineDirty.value) syncOutlineDraft();
}, { immediate: true });

onMounted(reload);
defineExpose({ reload });
</script>

<style scoped>
.ub-cm {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ub-cm__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4);
  border-bottom: 1px solid var(--ub-line-soft);
}

.ub-cm__spacer {
  flex: 1 1 auto;
}

.ub-cm__confirm {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  margin: var(--ub-s3) var(--ub-s4) 0;
  padding: var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-danger-soft);
  color: var(--ub-text);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-cm__pane {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s3);
  padding: var(--ub-s4);
}

.ub-cm__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--ub-s2);
}

.ub-cm__empty {
  padding: var(--ub-s4);
  border: 1px dashed var(--ub-line);
  border-radius: var(--ub-r-control);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-sm);
  text-align: center;
}

.ub-cm__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ub-cm__body {
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ub-cm__error {
  color: var(--ub-danger);
  font-size: var(--ub-fs-xs);
}

.ub-cm__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s1);
}

.ub-cm__hero {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s4);
  border-radius: var(--ub-r-card);
  background: linear-gradient(140deg, var(--ub-accent-soft), transparent 70%), var(--ub-sunken);
}

.ub-cm__hero-title {
  color: var(--ub-text);
  font-size: var(--ub-fs-lg);
  font-weight: 800;
}

.ub-cm__progress {
  height: 6px;
  border-radius: 999px;
  background: var(--ub-line-soft);
  overflow: hidden;
}

.ub-cm__progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ub-accent);
}

.ub-cm__node {
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
}

.ub-cm__node-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ub-s2);
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
}

.ub-cm__turns {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  margin: var(--ub-s2) 0 0;
  padding: 0;
  list-style: none;
}

.ub-cm__turns li {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  padding: var(--ub-s2) var(--ub-s3);
  border-left: 3px solid var(--ub-line);
  border-radius: 0 6px 6px 0;
  background: var(--ub-input-bg);
}

.ub-cm__turns li.is-done {
  border-left-color: var(--ub-ok);
  opacity: 0.6;
}

.ub-cm__turns li.is-current {
  border-left-color: var(--ub-accent);
  background: var(--ub-accent-soft);
}

.ub-cm__turn-goal {
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
}

.ub-cm__history {
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  padding: var(--ub-s2) var(--ub-s3);
}

.ub-cm__history > summary {
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  font-weight: 700;
  cursor: pointer;
}

.ub-cm__history--inner {
  margin-top: var(--ub-s2);
}

.ub-cm__history-body {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  margin-top: var(--ub-s2);
}

.ub-cm__list {
  margin: 0;
  padding-left: 1.4em;
  color: var(--ub-text-2);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-cm__status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: var(--ub-s2);
}

.ub-cm__status {
  padding: var(--ub-s2) var(--ub-s3);
  border-radius: var(--ub-r-control);
  background: var(--ub-sunken);
}

.ub-cm__status.is-bad {
  background: var(--ub-danger-soft);
}

.ub-cm__box {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
}

.ub-cm__box.is-warn {
  border-color: color-mix(in srgb, var(--ub-warn) 45%, var(--ub-line-soft));
  background: var(--ub-warn-soft);
}

.ub-cm__box-title,
.ub-cm__module-head {
  color: var(--ub-text);
  font-size: var(--ub-fs-md);
  font-weight: 800;
}

.ub-cm__module-head span {
  margin-left: var(--ub-s1);
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-cm__checks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ub-s2) var(--ub-s4);
}

.ub-cm__fix + .ub-cm__fix {
  padding-top: var(--ub-s2);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-cm__module {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding-top: var(--ub-s3);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-cm__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: var(--ub-s2);
}

.ub-cm__card {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s1);
  min-width: 0;
  padding: var(--ub-s3);
  border: 1px solid var(--ub-line-soft);
  border-radius: var(--ub-r-control);
  background: var(--ub-panel);
}

.ub-cm__card.is-retired {
  opacity: 0.55;
}

details.ub-cm__card > summary {
  cursor: pointer;
}

.ub-cm__reqs {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
}

.ub-cm__req {
  display: flex;
  align-items: flex-start;
  gap: var(--ub-s2);
}

.ub-cm__req-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.8em;
  height: 1.8em;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--ub-accent-soft);
  color: var(--ub-accent-ink);
  font-size: var(--ub-fs-xs);
  font-weight: 800;
}
</style>
