<template>
  <UbPage :sections="sections" wide>
    <UbSection
      id="cont-session"
      title="Agent 会话"
      description="像和 coding agent 对话一样使用：随时输入、随时打断。主 Agent 按需派工子代理并管理大纲，最终正文仍由酒馆模型生成。会话流最多显示最近 300 条，单条详情最多 2000 字。"
      icon="fa-solid fa-comments"
    >
      <ContinuationChat
        :task="runtime.task.value"
        :entries="session.entries.value"
        :running="session.running.value"
        :draft="messageDraft"
        :sending="messageSending"
        :status-text="runtime.statusText.value"
        :stage-text="stageText"
        :completed-turns="runtime.activeStage.value?.completedTurns ?? 0"
        :total-turns="runtime.activeRevision.value?.outline.totalTurns ?? 0"
        :revision-text="runtime.activeStage.value ? `revision ${runtime.activeStage.value.activeRevision}` : ''"
        :deadline-text="deadlineText"
        :awaiting-host="runtime.isAwaitingHostResult.value"
        @send="sendMessage"
        @update:draft="messageDraft = $event"
        @stop="runtime.stopTask"
      />
    </UbSection>

    <UbSection
      v-if="runtime.task.value && runtime.task.value.status === 'awaiting_outline_review' && runtime.activeRevision.value"
      id="cont-review"
      title="待确认的大纲"
      description="确认前会重新执行严格 Schema 与 revision 校验；页面不直接写入聊天数组。"
      icon="fa-solid fa-clipboard-check"
      padded
    >
      <UbTextarea :model-value="outlineDraft" :rows="16" mono aria-label="待确认的大纲" @update:model-value="outlineDraft = $event" />
      <p v-if="outlineDraftError" class="ub-cont__error">{{ outlineDraftError }}</p>
      <div class="ub-cont__actions">
        <UbButton variant="primary" icon="fa-solid fa-check" :busy="runtime.busy.value" @click="acceptOutlineDraft">确认大纲并继续</UbButton>
      </div>
    </UbSection>

    <UbSection id="cont-materials" title="已有资料" description="阶段大纲与本地资料都能直接编辑保存；一键清空只丢任务、会话记录与本地资料，不动小说正文。" icon="fa-solid fa-folder-open">
      <ContinuationMaterials
        ref="materialsPanel"
        :task="runtime.task.value"
        :active-stage="runtime.activeStage.value"
        :active-revision="runtime.activeRevision.value"
        :busy="runtime.busy.value"
        @save-outline="saveOutline"
        @clear="clearData"
        @repair="repairMaterials"
      />
    </UbSection>

    <UbSection
      v-if="settingsDraft"
      id="cont-settings"
      title="续写设置"
      description="修改后自动保存；任务运行中也能改，改动在本轮空档落盘、下一轮生效。默认值已能满足大多数场景。"
      icon="fa-solid fa-sliders"
    >
      <template #actions>
        <span v-if="settingsNotice" class="ub-cont__notice">{{ settingsNotice }}</span>
      </template>
      <div v-if="settingsError" class="ub-cont__pad"><UbCallout kind="error">{{ settingsError }}</UbCallout></div>

      <UbRow label="阶段规模" hint="一个阶段规划多少轮正文；轮数越多，单个大纲覆盖的剧情越长。">
        <UbSelect v-model="settingsDraft.stageSize" :options="STAGE_SIZE_OPTIONS" aria-label="阶段规模" />
      </UbRow>
      <template v-if="settingsDraft.stageSize === 'custom'">
        <UbRow label="最少轮次" hint="1–50 的整数，且不能大于最多轮次。">
          <UbInput v-model="settingsDraft.customTurnMin" type="number" :min="1" :max="50" aria-label="最少轮次" />
        </UbRow>
        <UbRow label="最多轮次" hint="1–50 的整数。">
          <UbInput v-model="settingsDraft.customTurnMax" type="number" :min="1" :max="50" aria-label="最多轮次" />
        </UbRow>
      </template>
      <UbRow label="故事总纲卷数" hint="故事总纲预计分多少卷推进，影响总纲子代理的整体节奏。">
        <UbSelect v-model="settingsDraft.storyArcVolumePlan" :options="VOLUME_PLAN_OPTIONS" aria-label="故事总纲卷数" />
      </UbRow>
      <UbRow v-if="settingsDraft.storyArcVolumePlan === 'custom'" label="自定义总纲卷数" hint="1–50 的整数。">
        <UbInput v-model="settingsDraft.customStoryArcVolumeCount" type="number" :min="1" :max="50" aria-label="自定义总纲卷数" />
      </UbRow>
      <UbRow label="API 预设（全局默认）" hint="所有 Agent 默认走这个预设；要给某个 Agent 单独指定，展开下方「各 Agent 渠道」。">
        <UbSelect
          :options="continuationApiPresetOptions"
          :model-value="continuationApiPresetValue"
          :placeholder="followActiveApiLabel"
          aria-label="续写 API 预设"
          @update:model-value="applyContinuationApiPreset"
        />
      </UbRow>
      <UbRow label="总时长（分钟）" hint="到点后自动停止任务，0 为不限时。">
        <UbInput v-model="settingsDraft.totalDurationMinutes" type="number" :min="0" aria-label="总时长（分钟）" />
      </UbRow>
      <UbRow label="大纲产出后先预览再执行">
        <UbSwitch v-model="settingsDraft.outlinePreview" aria-label="大纲产出后先预览再执行" />
      </UbRow>
      <UbRow label="启用发送前世界书终审" hint="开启后额外调用 final-reviewer，优先依据本轮命中的世界书条目，使用独立读取预算。">
        <UbSwitch v-model="settingsDraft.finalReview.enabled" aria-label="启用发送前世界书终审" />
      </UbRow>
      <UbRow label="自动修复违规模块" hint="达到次数上限后交主会话处理。">
        <UbSwitch v-model="settingsDraft.workflow.autoFixEnabled" aria-label="自动修复违规模块" />
      </UbRow>
      <UbRow label="启用开场百科检索" hint="同人推荐。新任务第一次规划前自动派工 web-researcher 查清原作设定。">
        <UbSwitch v-model="settingsDraft.webResearch.enabled" aria-label="启用开场百科检索" />
      </UbRow>
      <UbRow label="缓存优化" hint="为内部 AI 请求注入 prompt_cache_key 并统计缓存命中；个别网关不支持时可关闭。">
        <UbSwitch v-model="settingsDraft.promptCacheEnabled" aria-label="缓存优化" />
      </UbRow>

      <div class="ub-cont__groups">
        <UbDisclosure label="固定工作流" :meta="workflowGroupMeta" :expanded="isGroupExpanded('workflow')" @toggle="toggleGroup('workflow')">
          <p class="ub-cont__meta">主会话每轮只做开局决策。结算、策划、条件审查、容错提交、自动修复和写作指令由程序按固定顺序执行。这里只改配置，提示词在下方各角色分组里改。</p>
          <UbRow label="自动修复次数上限" hint="同一模块连续失败达该次数后停修，交主会话。范围 1–10。">
            <UbInput v-model="settingsDraft.workflow.autoFixMaxAttempts" type="number" :min="1" :max="10" aria-label="自动修复次数上限" />
          </UbRow>
          <UbRow label="终审打回上限" hint="写作指令按反馈清单增量修订次数。范围 1–10。">
            <UbInput v-model="settingsDraft.workflow.reviseLimit" type="number" :min="1" :max="10" aria-label="终审打回上限" />
          </UbRow>
          <UbRow label="修复额外读取轮数" hint="自动修复派工自有读写轮数，不占主会话额度。范围 0–10。">
            <UbInput v-model="settingsDraft.workflow.repairMaxExtraReads" type="number" :min="0" :max="10" aria-label="修复额外读取轮数" />
          </UbRow>
        </UbDisclosure>

        <UbDisclosure label="运行与重试" :meta="runGroupMeta" :expanded="isGroupExpanded('run')" @toggle="toggleGroup('run')">
          <UbRow label="自动阶段上限" hint="连续自动推进多少个阶段后暂停，等待你确认。">
            <UbInput v-model="settingsDraft.maxAutomaticStages" type="number" :min="1" aria-label="自动阶段上限" />
          </UbRow>
          <UbRow label="正文重试次数" hint="宿主生成失败、被中止、缺少循环标签或短于最低 token 数时最多重试几次。">
            <UbInput v-model="settingsDraft.generationRetryLimit" type="number" :min="0" aria-label="正文重试次数" />
          </UbRow>
          <UbRow label="正文最低 token 数" hint="低于该值视为截断或出错并自动重试，0 为不检查。">
            <UbInput v-model="settingsDraft.minGenerationTokens" type="number" :min="0" aria-label="正文最低 token 数" />
          </UbRow>
          <UbRow label="内部 AI 重试次数" hint="Agent 自身调用 API 失败时的重试次数。">
            <UbInput v-model="settingsDraft.internalAiRetryLimit" type="number" :min="0" aria-label="内部 AI 重试次数" />
          </UbRow>
          <UbRow label="轮次延迟（秒）" hint="每轮正文完成后等待多久再开始下一轮。">
            <UbInput v-model="settingsDraft.loopDelaySeconds" type="number" :min="0" aria-label="轮次延迟（秒）" />
          </UbRow>
          <UbRow label="重试延迟（秒）" hint="失败后等待多久再重试；遇到 429 限流可适当调大。">
            <UbInput v-model="settingsDraft.retryDelaySeconds" type="number" :min="0" aria-label="重试延迟（秒）" />
          </UbRow>
          <UbRow label="连续高压轮上限" hint="跨阶段累计多少轮没有日常/余波轮就强制安排一轮，0 为不作要求。只兜底极端情况。">
            <UbInput v-model="settingsDraft.maxConsecutivePressureTurns" type="number" :min="0" :max="maxConsecutivePressureTurnsMax" aria-label="连续高压轮上限" />
          </UbRow>
          <UbRow label="循环标签" hint="逗号分隔；正文缺少任一标签就视为失败并重试。留空不检查。" stack>
            <UbInput v-model="settingsDraft.loopTags" aria-label="循环标签" />
          </UbRow>
        </UbDisclosure>

        <UbDisclosure label="正文读取与上下文" :meta="contextGroupMeta" :expanded="isGroupExpanded('context')" @toggle="toggleGroup('context')">
          <UbRow label="正文可读窗口楼数" hint="只有最近这么多 AI 楼层能被 Agent 读取/搜索，更早剧情走纪要回溯；0 为不开放。">
            <UbInput v-model="settingsDraft.storyWindowFloors" type="number" :min="0" aria-label="正文可读窗口楼数" />
          </UbRow>
          <UbRow label="正文目录尾部全文楼数" hint="最近几楼直接注入全文作承接锚点，其余窗口内楼层只进目录按需调阅。">
            <UbInput v-model="settingsDraft.storyTailFloors" type="number" :min="0" aria-label="正文目录尾部全文楼数" />
          </UbRow>
          <UbRow label="会话自动总结阈值（token）" hint="按主 Agent 实际读取的完整上下文统计，超过后把最早轮次浓缩成交接报告；0 为不总结。">
            <UbInput v-model="settingsDraft.agentHistoryTokenBudget" type="number" :min="0" aria-label="会话自动总结阈值" />
          </UbRow>
          <UbRow label="单批次读取上限" hint="一次 read/search 批次最多注入多少 token；填正整数或形如 20% 的百分比（按总结阈值折算）。">
            <UbInput v-model="settingsDraft.agentReadTokenBudget" aria-label="单批次读取上限" />
          </UbRow>
          <UbRow label="临近总结时的精读额度（token）" hint="上下文即将触发总结时，只有不超过此大小的单批次读取会放行；默认 6000。">
            <UbInput v-model="settingsDraft.agentReadFallbackTokens" type="number" :min="1" aria-label="临近总结时的精读额度" />
          </UbRow>
        </UbDisclosure>

        <UbDisclosure label="Agent 运行预算" :meta="budgetGroupMeta" :expanded="isGroupExpanded('budget')" @toggle="toggleGroup('budget')">
          <UbRow label="主 Agent 迭代上限" hint="一次规划内最多做多少次决策（read/search 批次不计入）。范围 1–30。">
            <UbInput v-model="settingsDraft.agentRunBudget.maxIterations" type="number" :min="1" :max="30" aria-label="主 Agent 迭代上限" />
          </UbRow>
          <UbRow label="派工总数上限" hint="一次规划内最多派出多少个子代理任务，0 为禁止派工。范围 0–20。">
            <UbInput v-model="settingsDraft.agentRunBudget.maxDelegations" type="number" :min="0" :max="20" aria-label="派工总数上限" />
          </UbRow>
          <UbRow label="单代理派工上限" hint="同一个子代理在一次规划内最多被派几次。范围 1–10。">
            <UbInput v-model="settingsDraft.agentRunBudget.maxSameAgent" type="number" :min="1" :max="10" aria-label="单代理派工上限" />
          </UbRow>
          <UbRow label="并发派工上限" hint="同一波次最多同时运行几个子代理；API 限流严格时调小。范围 1–6。">
            <UbInput v-model="settingsDraft.agentRunBudget.maxConcurrent" type="number" :min="1" :max="6" aria-label="并发派工上限" />
          </UbRow>
          <UbRow label="读取批次上限" hint="主 Agent 一次规划内 read/search 批次的次数上限，0 为禁止读取。范围 0–30。">
            <UbInput v-model="settingsDraft.agentRunBudget.maxReads" type="number" :min="0" :max="30" aria-label="读取批次上限" />
          </UbRow>
          <UbRow label="子代理工具轮上限" hint="子代理首轮之外还允许几轮追加读取，0 为只靠固定注入与派工种子。范围 0–10。">
            <UbInput v-model="settingsDraft.agentRunBudget.maxExtraReads" type="number" :min="0" :max="10" aria-label="子代理工具轮上限" />
          </UbRow>
        </UbDisclosure>

        <UbDisclosure label="发送前终审" :meta="finalReviewGroupMeta" :expanded="isGroupExpanded('finalReview')" @toggle="toggleGroup('finalReview')">
          <UbRow label="终审单批次读取上限" hint="终审每次 read/search 批次最多注入多少 token；填正整数或形如 50% 的百分比。">
            <UbInput v-model="settingsDraft.finalReview.readTokenBudget" aria-label="终审单批次读取上限" />
          </UbRow>
          <UbRow label="终审额外读取轮数" hint="终审首轮之外允许追加 read/search 的次数，0 为只使用固定证据。范围 0–10。">
            <UbInput v-model="settingsDraft.finalReview.maxExtraReads" type="number" :min="0" :max="10" aria-label="终审额外读取轮数" />
          </UbRow>
          <p class="ub-cont__meta">终审默认关闭；关闭时不装配终审证据、不额外读取世界书，也不会发起终审调用。</p>
        </UbDisclosure>

        <UbDisclosure label="网页检索" :meta="webResearchGroupMeta" :expanded="isGroupExpanded('webResearch')" @toggle="toggleGroup('webResearch')">
          <p class="ub-cont__meta">开启后，新任务第一次规划前会派工 web-researcher 从勾选的百科查清原作设定并写进「百科资料」。TT 下萌娘百科与维基百科可直连；通用搜索只支持 SearXNG（需填写实例地址）；百度百科、DuckDuckGo、Serper/Tavily 需酒馆服务器转发，TT 暂不支持。</p>
          <div class="ub-cont__checks">
            <UbCheck v-model="settingsDraft.webResearch.sources.moegirl" label="萌娘百科（直连）" />
            <UbCheck v-model="settingsDraft.webResearch.sources.wikipediaZh" label="中文维基百科（直连）" />
            <UbCheck v-model="settingsDraft.webResearch.sources.wikipediaEn" label="英文维基百科（直连）" />
            <UbCheck v-model="settingsDraft.webResearch.sources.baidu" label="百度百科（TT 暂不支持，请勿勾选）" />
          </div>
          <UbRow label="搜索引擎" hint="百科查不到时的兜底搜索。TT 仅支持 SearXNG。" stack>
            <UbSelect v-model="settingsDraft.webResearch.searchProvider" :options="WEB_SEARCH_PROVIDER_OPTIONS" aria-label="搜索引擎" />
          </UbRow>
          <UbRow v-if="settingsDraft.webResearch.searchProvider === 'searxng'" label="SearXNG 实例地址" hint="实例根地址，如 https://searx.example.org（不要带路径）。" stack>
            <UbInput v-model="settingsDraft.webResearch.searxngBaseUrl" aria-label="SearXNG 实例地址" />
          </UbRow>
          <UbRow label="单次工具轮上限" hint="一次派工里搜索/抓取/本地调阅的轮数上限。范围 1–20。">
            <UbInput v-model="settingsDraft.webResearch.maxToolRounds" type="number" :min="1" :max="20" aria-label="单次工具轮上限" />
          </UbRow>
          <UbRow label="单次抓取页数上限" hint="单次检索最多精读的外部页面数，正文不写入聊天。范围 1–30。">
            <UbInput v-model="settingsDraft.webResearch.maxPages" type="number" :min="1" :max="30" aria-label="单次抓取页数上限" />
          </UbRow>
          <UbRow label="单页阅读字数上限" hint="归纳资料时可读取的单页正文上限；正文不保存。范围 500–20000。">
            <UbInput v-model="settingsDraft.webResearch.pageCharLimit" type="number" :min="500" :max="20000" aria-label="单页阅读字数上限" />
          </UbRow>
          <UbRow label="域名黑名单" hint="web_read 不得抓取的域名，逗号或换行分隔；内网与酒馆自身始终被拦。" stack>
            <UbTextarea v-model="settingsDraft.webResearch.blockedDomains" :rows="3" aria-label="域名黑名单" />
          </UbRow>
        </UbDisclosure>

        <UbDisclosure label="各 Agent 渠道" :meta="channelGroupMeta" :expanded="isGroupExpanded('channels')" @toggle="toggleGroup('channels')">
          <p class="ub-cont__meta">给不同 Agent 分配不同 API 预设：例如主 Agent 用强模型，审查类子代理用便宜快速的模型。「跟随全局默认」即使用上方的 API 预设。</p>
          <UbRow v-for="channel in agentChannelRoles" :key="channel.role" :label="channel.label">
            <UbSelect
              :options="agentChannelOptions"
              :model-value="agentChannelValue(channel.role)"
              :aria-label="`${channel.label} 渠道`"
              @update:model-value="value => applyAgentChannel(channel.role, value)"
            />
          </UbRow>
        </UbDisclosure>

        <UbDisclosure label="上下文提取与排除规则" :meta="rulesGroupMeta" :expanded="isGroupExpanded('rules')" @toggle="toggleGroup('rules')">
          <p class="ub-cont__meta">提取规则只保留正文中匹配「起始–结束」标记之间的内容；排除规则把匹配段落剔除。两者都为空时使用完整正文。</p>
          <UbRulePairs v-model="settingsDraft.contextExtractRules" label="上下文提取规则" />
          <UbRulePairs v-model="settingsDraft.contextExcludeRules" label="上下文排除规则" />
        </UbDisclosure>
      </div>
    </UbSection>

    <UbSection
      v-if="settingsDraft"
      id="cont-prompts"
      title="伪 Role 提示词"
      description="只有启用的段参与内部调用；占位符按实际出现按需解析。修改后自动保存。"
      icon="fa-solid fa-scroll"
    >
      <template #actions>
        <UbButton size="sm" variant="ghost" icon="fa-solid fa-upload" @click="exportPrompts">导出 JSON</UbButton>
        <UbFileButton size="sm" variant="ghost" icon="fa-solid fa-download" accept=".json,application/json" @file="onImportPromptsFile">导入 JSON</UbFileButton>
      </template>
      <div v-if="promptIoError || promptIoNotice || settingsError" class="ub-cont__pad">
        <UbCallout v-if="promptIoError" kind="error">{{ promptIoError }}</UbCallout>
        <UbCallout v-if="promptIoNotice" kind="success">{{ promptIoNotice }}</UbCallout>
        <UbCallout v-if="settingsError" kind="error">{{ settingsError }}</UbCallout>
      </div>
      <div class="ub-cont__groups">
        <UbDisclosure
          v-for="group in promptGroups"
          :key="group.key"
          :label="group.title"
          :meta="promptGroupMeta(group.key)"
          :expanded="isGroupExpanded(`prompt:${group.key}`)"
          @toggle="toggleGroup(`prompt:${group.key}`)"
        >
          <p v-if="group.note" class="ub-cont__meta">{{ group.note }}</p>
          <UbPromptSegments
            :segments="promptList(group.key) ?? []"
            :role-options="CONTINUATION_ROLE_OPTIONS"
            :show-slot="false"
            show-enabled
            allow-move
            @add="position => addPrompt(group.key, position)"
            @delete="index => deletePrompt(group.key, index)"
            @move="(index, delta) => movePrompt(group.key, index, delta)"
            @update="(index, patch) => updatePrompt(group.key, index, patch)"
          />
          <div class="ub-cont__actions">
            <UbButton size="sm" variant="ghost" icon="fa-solid fa-rotate-left" @click="restorePrompt(group.kind)">{{ group.restoreLabel }}</UbButton>
          </div>
        </UbDisclosure>
        <UbDisclosure label="占位符速查" meta="参考" :expanded="isGroupExpanded('prompt:reference')" @toggle="toggleGroup('prompt:reference')">
          <h4 class="ub-cont__subhead">大纲子代理</h4>
          <p class="ub-cont__meta">$USER_REQUIREMENTS（用户累计要求）、$ORIGIN_INSTRUCTION（创建任务时的初始要求原文）、$1、$STORY_OVERVIEW（事件概览）、$STORY_TAIL（尾部楼层全文）、$STAGE_HISTORY、$COMPLETED_STAGE_PART、$REPLAN_INSTRUCTION、$TURN_RANGE、$REMAINING_TURNS、$STORY_ARC（故事总纲）、$STAGE_WORD_BUDGET（本阶段字数容量）、$PACING_CONTEXT（跨阶段节奏状态）、$VALIDATION_ERRORS。</p>
          <h4 class="ub-cont__subhead">主 Agent</h4>
          <p class="ub-cont__meta">$HISTORY_ANCHOR 标记主 Agent 会话记录的插入位置，该段本身不发送；删掉它会让会话记录退回到序列最前面。正文三层注入：$STORY_OVERVIEW、$STORY_TAIL、$STORY_CATALOG（楼层索引）。目录与状态：$OUTLINE_STATE、$WORLDBOOK_CATALOG、$WORLDBOOK_HITS、$AGENT_READ_CATALOG。其余：$USER_REQUIREMENTS、$USER_INTENT、$CURRENT_TURN_GOAL、$CURRENT_TURN_PACING、$STORY_ARC_STATE、$HISTORY_UNSETTLED、$AGENT_CATALOG、$MODULE_CATALOG、$TABLE_CATALOG、$BUDGET；旧版 $OUTLINE_WINDOW、$ACTIVE_CONSTRAINTS、$TOOL_RESULTS 仍可在自定义提示词中使用。</p>
          <h4 class="ub-cont__subhead">各子代理</h4>
          <p class="ub-cont__meta">$USER_REQUIREMENTS、$AGENT_READ_MATERIALS（派工种子读集解析出的资料）、$AGENT_TASK、$AGENT_WRITE_SCOPE、$AGENT_READ_CATALOG、$STORY_OVERVIEW / $STORY_TAIL / $HISTORY_UNSETTLED、$HOOKS_LEDGER / $INFO_GAP / $ACTIVE_CONSTRAINTS / $STORY_ARC / $CHRONOLOGY / $WEB_REFS（$WEB_REFS 只给名称 + 一句话简介）、$STORY_CATALOG、$TABLE_CATALOG、$WORLDBOOK_CATALOG、$WORLDBOOK_HITS；网页检索子代理另有 $WEB_TOOL_CATALOG。固定注入差异：主 Agent、总纲代理、两类策划代理、连续性审查、终审与用户要求维护固定获得 $OUTLINE_WINDOW 或任务段中的 $USER_REQUIREMENTS；大纲代理默认使用 $USER_REQUIREMENTS，自定义段仍可使用 $ORIGIN_INSTRUCTION；伏笔与认知维护代理不再注入初始要求原文，只接收累计用户要求清单，避免计划污染事实结算。</p>
        </UbDisclosure>
      </div>
    </UbSection>
  </UbPage>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { downloadJsonToHost_ACU } from '../../presentation-v2/bootstrap/host-download';
import { useApiPresetSelectOptions } from '../../presentation-v2/composables/useApiPresetSelectOptions';
import { useChatMutationTick, watchChatChanged_ACU } from '../../presentation-v2/composables/useChatChangedListener';
import {
  CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU,
  useContinuationRuntime,
} from '../../presentation-v2/composables/useContinuationRuntime';
import { useContinuationSession } from '../../presentation-v2/composables/useContinuationSession';
import { useDialogStore } from '../../presentation-v2/stores/dialog-store';
import type { AgentWritableModule_ACU } from '../../service/continuation/agent/agent-model';
import type { ContinuationPromptSegment_ACU, ContinuationSettings_ACU, StageOutline_ACU } from '../../service/continuation/model';
import type { ContinuationPromptKind_ACU } from '../../service/continuation/prompt-template';
import { currentChatFileIdentifier_ACU } from '../../service/runtime/state-manager';
import ContinuationChat from '../parts/ContinuationChat.vue';
import ContinuationMaterials from '../parts/ContinuationMaterials.vue';
import UbButton from '../ui/UbButton.vue';
import UbCallout from '../ui/UbCallout.vue';
import UbCheck from '../ui/UbCheck.vue';
import UbDisclosure from '../ui/UbDisclosure.vue';
import UbFileButton from '../ui/UbFileButton.vue';
import UbInput from '../ui/UbInput.vue';
import UbPage from '../ui/UbPage.vue';
import UbPromptSegments from '../ui/UbPromptSegments.vue';
import UbRow from '../ui/UbRow.vue';
import UbRulePairs from '../ui/UbRulePairs.vue';
import UbSection from '../ui/UbSection.vue';
import UbSelect from '../ui/UbSelect.vue';
import UbSwitch from '../ui/UbSwitch.vue';
import UbTextarea from '../ui/UbTextarea.vue';
import { readFileText_UB } from '../ui/file-helpers';

const STAGE_SIZE_OPTIONS = [
  { value: 'short', label: '短（3–5）' },
  { value: 'standard', label: '标准（6–10）' },
  { value: 'long', label: '长（11–20）' },
  { value: 'custom', label: '自定义' },
];

const VOLUME_PLAN_OPTIONS = [
  { value: 'short', label: '短线（7–8 卷）' },
  { value: 'medium', label: '中线（10–14 卷）' },
  { value: 'long', label: '长线（20 卷）' },
  { value: 'custom', label: '自定义' },
];

const WEB_SEARCH_PROVIDER_OPTIONS = [
  { value: 'searxng', label: 'SearXNG（自建/公共实例，TT 唯一可用）' },
  { value: 'duckduckgo', label: 'DuckDuckGo（需酒馆转发，TT 暂不支持）' },
  { value: 'serper', label: 'Serper（需酒馆已配 key，TT 暂不支持）' },
  { value: 'tavily', label: 'Tavily（需酒馆已配 key，TT 暂不支持）' },
];

const CONTINUATION_ROLE_OPTIONS = [
  { value: 'system', label: 'SYSTEM' },
  { value: 'user', label: 'USER' },
  { value: 'assistant', label: 'ASSISTANT' },
];

/** 渠道下拉里「跟随全局默认」的哨兵值：空串已被「跟随当前活动 API」占用。 */
const INHERIT_CHANNEL_VALUE = '__inherit__';

const agentChannelRoles = [
  { role: 'main', label: '主 Agent' },
  { role: 'outline', label: '大纲子代理' },
  { role: 'arcArchitect', label: '故事总纲' },
  { role: 'maintainer', label: '伏笔与认知维护' },
  { role: 'mainlinePlanner', label: '主线推进策划' },
  { role: 'beatPlanner', label: '伏笔与节拍策划' },
  { role: 'reviewer', label: '连续性审查' },
  { role: 'finalReviewer', label: '发送前终审' },
  { role: 'webResearcher', label: '网页检索' },
  { role: 'instructionComposer', label: '写作指令编排' },
  { role: 'requirementsMaintainer', label: '用户要求维护' },
] as const;
type AgentChannelRole = typeof agentChannelRoles[number]['role'];

type PromptKey = 'outlinePrompt' | 'main' | 'arcArchitect' | 'maintainer' | 'mainlinePlanner' | 'beatPlanner' | 'reviewer' | 'finalReviewer' | 'webResearcher' | 'instructionComposer' | 'requirementsMaintainer';
interface PromptGroupDef {
  key: PromptKey;
  kind: ContinuationPromptKind_ACU;
  title: string;
  restoreLabel: string;
  note?: string;
}

const promptGroups: PromptGroupDef[] = [
  { key: 'outlinePrompt', kind: 'outline', title: '大纲子代理（outline-architect）', restoreLabel: '恢复大纲提示词默认值' },
  { key: 'main', kind: 'agent_main', title: '主 Agent', restoreLabel: '恢复主 Agent 默认值', note: '$HISTORY_ANCHOR 段标记会话记录的插入位置，本身不发送；删掉它会让会话记录退回到序列最前面。' },
  { key: 'arcArchitect', kind: 'agent_arc', title: '故事总纲子代理（arc-architect）', restoreLabel: '恢复总纲子代理默认值' },
  { key: 'maintainer', kind: 'agent_maintainer', title: '伏笔与认知维护子代理', restoreLabel: '恢复维护子代理默认值', note: '该代理只接收累计用户要求清单，不接收阶段大纲，避免计划污染事实结算。' },
  { key: 'mainlinePlanner', kind: 'agent_mainline', title: '主线推进策划子代理', restoreLabel: '恢复主线策划默认值' },
  { key: 'beatPlanner', kind: 'agent_beat', title: '伏笔与节拍策划子代理', restoreLabel: '恢复节拍策划默认值' },
  { key: 'reviewer', kind: 'agent_reviewer', title: '连续性审查子代理', restoreLabel: '恢复审查子代理默认值' },
  { key: 'finalReviewer', kind: 'agent_final_reviewer', title: '发送前终审子代理', restoreLabel: '恢复终审子代理默认值', note: '仅在「启用发送前世界书终审」开启时，固定工作流会在 instruction-composer 之后调用它。' },
  { key: 'instructionComposer', kind: 'agent_instruction_composer', title: '写作指令编排子代理（instruction-composer）', restoreLabel: '恢复写作指令编排默认值', note: '固定工作流在策划与审查之后调用，是唯一产出本轮写作指令的角色。契约 JSON 为 {instruction, summary, constraints}。' },
  { key: 'webResearcher', kind: 'agent_web_researcher', title: '网页检索子代理（web-researcher）', restoreLabel: '恢复网页检索默认值', note: '仅在「启用开场百科检索」开启时调用。专属占位符：$WEB_TOOL_CATALOG、$WEB_REFS。' },
  { key: 'requirementsMaintainer', kind: 'agent_requirements_maintainer', title: '用户要求维护子代理（requirements-maintainer）', restoreLabel: '恢复用户要求维护默认值', note: '由会话压缩后的系统派工触发。契约 JSON 为 {requirements, summary} 全量替换。' },
];

const runtime = useContinuationRuntime();
const runtimeSettingsIdentity = runtime.settingsIdentity ?? computed(() => currentDraftChatIdentity());
const dialog = useDialogStore();
const session = useContinuationSession();
const { apiStore, followActiveApiLabel, apiPresetSelectOptions: continuationApiPresetOptions } = useApiPresetSelectOptions();
const maxConsecutivePressureTurnsMax = CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU;

const settingsDraft = ref<ContinuationSettings_ACU | null>(null);
const draftChatIdentity = ref(String(currentChatFileIdentifier_ACU || ''));
const outlineDraft = ref('');
const messageDraft = ref('');
const messageSending = ref(false);
const outlineDraftError = ref('');
const settingsError = ref('');
const settingsNotice = ref('');
const promptIoError = ref('');
const promptIoNotice = ref('');
const materialsPanel = ref<InstanceType<typeof ContinuationMaterials> | null>(null);
const clock = ref(Date.now());
/** 折叠分组展开状态：默认全收起，只在本次打开期间记忆。 */
const expandedGroups = reactive<Record<string, boolean>>({});

const sections = computed(() => [
  { id: 'cont-session', label: '会话' },
  ...(runtime.task.value?.status === 'awaiting_outline_review' && runtime.activeRevision.value ? [{ id: 'cont-review', label: '待确认大纲' }] : []),
  { id: 'cont-materials', label: '资料' },
  ...(settingsDraft.value ? [{ id: 'cont-settings', label: '设置' }, { id: 'cont-prompts', label: '提示词' }] : []),
]);

let countdownTimer: ReturnType<typeof setInterval> | undefined;

function stopCountdownTimer(): void {
  if (countdownTimer === undefined) return;
  clearInterval(countdownTimer);
  countdownTimer = undefined;
}

/** 倒计时心跳按需启停：只有任务带截止时间才每秒推进，避免空页面每秒整页重渲染。 */
function syncCountdownTimer(deadlineAt: number | null | undefined): void {
  if (deadlineAt === null || deadlineAt === undefined) {
    stopCountdownTimer();
    return;
  }
  if (countdownTimer !== undefined) return;
  clock.value = Date.now();
  countdownTimer = setInterval(() => { clock.value = Date.now(); }, 1_000);
}
watch(() => runtime.task.value?.deadlineAt, syncCountdownTimer, { immediate: true });

const stageText = computed(() => {
  const stage = runtime.activeStage.value;
  if (!runtime.task.value) return '尚未创建任务';
  return stage ? `第 ${stage.stageNumber} 阶段` : '大纲待创建';
});

const deadlineText = computed(() => {
  const deadlineAt = runtime.task.value?.deadlineAt;
  if (deadlineAt === null || deadlineAt === undefined) return '未设置';
  const remaining = Math.max(0, Math.ceil((deadlineAt - clock.value) / 1_000));
  const pad = (v: number) => v.toString().padStart(2, '0');
  return `${pad(Math.floor(remaining / 3_600))}:${pad(Math.floor((remaining % 3_600) / 60))}:${pad(remaining % 60)}`;
});

const continuationApiPresetValue = computed(() => {
  if (!settingsDraft.value) return '';
  return settingsDraft.value.apiPresetMode === 'fixed' ? settingsDraft.value.fixedApiPresetName : '';
});

function applyContinuationApiPreset(value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value || '').trim();
  if (trimmed) {
    settingsDraft.value.apiPresetMode = 'fixed';
    settingsDraft.value.fixedApiPresetName = trimmed;
  } else {
    settingsDraft.value.apiPresetMode = 'current';
    settingsDraft.value.fixedApiPresetName = '';
  }
  // 渠道选择即保存，不等防抖窗口，避免离开页面时丢失
  saveSettingsImmediately();
}

function isGroupExpanded(key: string): boolean {
  return expandedGroups[key] === true;
}

function toggleGroup(key: string): void {
  expandedGroups[key] = !isGroupExpanded(key);
}

/** 折叠态的一行摘要：不展开也能看到关键取值。 */
const runGroupMeta = computed(() => {
  const s = settingsDraft.value;
  return s ? `阶段上限 ${s.maxAutomaticStages} · 正文重试 ${s.generationRetryLimit} 次` : '';
});
const contextGroupMeta = computed(() => {
  const s = settingsDraft.value;
  return s ? `窗口 ${s.storyWindowFloors} 楼 · 总结阈值 ${s.agentHistoryTokenBudget}` : '';
});
const budgetGroupMeta = computed(() => {
  const s = settingsDraft.value;
  return s ? `迭代 ${s.agentRunBudget.maxIterations} · 派工 ${s.agentRunBudget.maxDelegations} · 并发 ${s.agentRunBudget.maxConcurrent}` : '';
});
const finalReviewGroupMeta = computed(() => (settingsDraft.value?.finalReview.enabled ? '已开启' : '已关闭'));
const workflowGroupMeta = computed(() => {
  const workflow = settingsDraft.value?.workflow;
  if (!workflow) return '';
  return `${workflow.autoFixEnabled ? '自动修复开' : '自动修复关'} · 修复 ${workflow.autoFixMaxAttempts} 次 · 打回 ${workflow.reviseLimit} 次`;
});
const webResearchGroupMeta = computed(() => {
  const web = settingsDraft.value?.webResearch;
  if (!web) return '';
  if (!web.enabled) return '已关闭';
  const sources = [web.sources.moegirl && '萌娘', web.sources.wikipediaZh && '中文维基', web.sources.wikipediaEn && '英文维基', web.sources.baidu && '百度'].filter(Boolean);
  return `已开启 · ${sources.length ? sources.join('/') : '无百科来源'} · ${web.searchProvider}`;
});
const channelGroupMeta = computed(() => {
  const presets = settingsDraft.value?.agentApiPresets;
  if (!presets) return '';
  const customized = agentChannelRoles.filter(channel => presets[channel.role]?.mode !== 'inherit').length;
  return customized ? `${customized} 个单独指定` : '全部跟随默认';
});
const rulesGroupMeta = computed(() => {
  const s = settingsDraft.value;
  return s ? `提取 ${s.contextExtractRules.length} · 排除 ${s.contextExcludeRules.length}` : '';
});

const agentChannelOptions = computed(() => [
  { value: INHERIT_CHANNEL_VALUE, label: '跟随全局默认' },
  ...continuationApiPresetOptions.value,
]);

function agentChannelValue(role: AgentChannelRole): string {
  const choice = settingsDraft.value?.agentApiPresets?.[role];
  if (!choice || choice.mode === 'inherit') return INHERIT_CHANNEL_VALUE;
  return choice.mode === 'fixed' ? choice.presetName : '';
}

function applyAgentChannel(role: AgentChannelRole, value: string): void {
  if (!settingsDraft.value) return;
  const trimmed = String(value ?? '').trim();
  if (trimmed === INHERIT_CHANNEL_VALUE) settingsDraft.value.agentApiPresets[role] = { mode: 'inherit', presetName: '' };
  else if (trimmed) settingsDraft.value.agentApiPresets[role] = { mode: 'fixed', presetName: trimmed };
  else settingsDraft.value.agentApiPresets[role] = { mode: 'current', presetName: '' };
  saveSettingsImmediately();
}

function cloneSettings(settings: ContinuationSettings_ACU): ContinuationSettings_ACU {
  return {
    ...settings,
    contextExtractRules: settings.contextExtractRules.map(rule => ({ ...rule })),
    contextExcludeRules: settings.contextExcludeRules.map(rule => ({ ...rule })),
    agentRunBudget: { ...settings.agentRunBudget },
    finalReview: { ...settings.finalReview },
    workflow: { autoFixEnabled: true, autoFixMaxAttempts: 3, reviseLimit: 3, repairMaxExtraReads: 2, ...settings.workflow },
    webResearch: { ...settings.webResearch, sources: { ...settings.webResearch.sources } },
    agentApiPresets: {
      main: { ...settings.agentApiPresets.main },
      outline: { ...settings.agentApiPresets.outline },
      arcArchitect: { ...settings.agentApiPresets.arcArchitect },
      maintainer: { ...settings.agentApiPresets.maintainer },
      mainlinePlanner: { ...settings.agentApiPresets.mainlinePlanner },
      beatPlanner: { ...settings.agentApiPresets.beatPlanner },
      reviewer: { ...settings.agentApiPresets.reviewer },
      finalReviewer: { ...settings.agentApiPresets.finalReviewer },
      webResearcher: { ...settings.agentApiPresets.webResearcher },
      instructionComposer: { ...(settings.agentApiPresets.instructionComposer ?? { mode: 'inherit', presetName: '' }) },
      requirementsMaintainer: { ...(settings.agentApiPresets.requirementsMaintainer ?? { mode: 'inherit', presetName: '' }) },
    },
    outlinePrompt: settings.outlinePrompt.map(segment => ({ ...segment })),
    agentPrompts: {
      main: settings.agentPrompts.main.map(segment => ({ ...segment })),
      arcArchitect: settings.agentPrompts.arcArchitect.map(segment => ({ ...segment })),
      maintainer: settings.agentPrompts.maintainer.map(segment => ({ ...segment })),
      mainlinePlanner: settings.agentPrompts.mainlinePlanner.map(segment => ({ ...segment })),
      beatPlanner: settings.agentPrompts.beatPlanner.map(segment => ({ ...segment })),
      reviewer: settings.agentPrompts.reviewer.map(segment => ({ ...segment })),
      finalReviewer: settings.agentPrompts.finalReviewer.map(segment => ({ ...segment })),
      webResearcher: settings.agentPrompts.webResearcher.map(segment => ({ ...segment })),
      instructionComposer: (settings.agentPrompts.instructionComposer ?? []).map(segment => ({ ...segment })),
      requirementsMaintainer: (settings.agentPrompts.requirementsMaintainer ?? []).map(segment => ({ ...segment })),
    },
  };
}

function syncOutlineDraft(): void {
  outlineDraft.value = runtime.activeRevision.value ? JSON.stringify(runtime.activeRevision.value.outline, null, 2) : '';
  outlineDraftError.value = '';
}

function parseOutlineDraft(): StageOutline_ACU | null {
  try {
    const parsed: unknown = JSON.parse(outlineDraft.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('大纲必须是 JSON 对象');
    return parsed as StageOutline_ACU;
  } catch (error) {
    outlineDraftError.value = error instanceof Error ? error.message : '大纲 JSON 无法解析';
    return null;
  }
}

async function acceptOutlineDraft(): Promise<void> {
  const outline = parseOutlineDraft();
  if (!outline) return;
  if (await runtime.acceptOutline(outline)) syncOutlineDraft();
}

/** 首次发送（即将创建任务）前的高 RPM 风险确认：5 秒倒计时结束前只能取消。 */
async function confirmFirstSendRpmWarning(): Promise<boolean> {
  return dialog.confirm({
    title: '开始智能续写前请确认',
    message: '本功能单次请求占用的 Token 不多，但 Agent 会连续发起大量请求，需要 API 支持很高的 RPM（每分钟请求数）。',
    dangerMessage: '禁止使用任何公益站，除非它明确表示允许 coding（本功能的请求模式与 coding 类似）。违规使用可能导致账号被封禁。',
    confirmLabel: '我已了解，开始',
    cancelLabel: '取消',
    confirmVariant: 'danger',
    confirmCountdownSeconds: 5,
  });
}

function currentDraftChatIdentity(): string {
  return String(currentChatFileIdentifier_ACU || '');
}

function ensureCurrentDraftChat(): boolean {
  if (draftChatIdentity.value === currentDraftChatIdentity()) return true;
  messageDraft.value = '';
  outlineDraft.value = '';
  settingsDraft.value = null;
  settingsError.value = '';
  settingsNotice.value = '聊天已切换，旧草稿已清空；请重新载入当前聊天。';
  return false;
}

/** 会话发送：没有任务时创建任务；运行中会打断当前迭代并带着这句话重新开始。 */
async function sendMessage(text: string): Promise<void> {
  if (!ensureCurrentDraftChat()) return;
  if (messageSending.value) return;
  if (!runtime.task.value && !(await confirmFirstSendRpmWarning())) return;
  if (messageSending.value) return;
  messageSending.value = true;
  try {
    const accepted = await runtime.sendAgentMessage(text);
    if (accepted && messageDraft.value.trim() === text) messageDraft.value = '';
  } finally {
    messageSending.value = false;
  }
}

async function repairMaterials(modules: readonly AgentWritableModule_ACU[]): Promise<void> {
  if (await runtime.repairPendingMaterials(modules)) materialsPanel.value?.reload();
}

/** 手动改写的大纲保存成功后刷新资料面板，读到新的 revision。 */
async function saveOutline(outline: StageOutline_ACU, base: { stageId: string; revision: number } | null): Promise<void> {
  if (await runtime.saveActiveOutline(outline, base)) materialsPanel.value?.reload();
}

async function clearData(): Promise<void> {
  if (await runtime.clearData()) materialsPanel.value?.reload();
}

function requiredInteger(value: unknown, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric)) throw new Error(`${label} 必须是整数`);
  return numeric;
}

/** 上下界俱全的整数设置；空串与 NaN 在这里先拦成可读提示。 */
function requiredRangeInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error(`${label} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  return numeric;
}

/** 读取预算接受两种形态：正整数（固定 token 数）或 1%-100% 的百分比串（按总结阈值折算）。 */
function normalizedReadBudget(value: unknown): number | string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('读取上限不能为空');
  if (raw.endsWith('%')) {
    const percent = Number.parseFloat(raw);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error('读取上限百分比必须在 1% 到 100% 之间');
    return `${percent}%`;
  }
  const fixed = Number(raw);
  if (!Number.isInteger(fixed) || fixed < 1) throw new Error('读取上限必须是正整数，或形如 20% 的百分比');
  return fixed;
}

function presetExists(presetName: string): boolean {
  return apiStore.presets.some(preset => preset.name === presetName);
}

function normalizeSettingsDraft(): ContinuationSettings_ACU {
  if (!settingsDraft.value) throw new Error('续写设置尚未加载');
  const source = settingsDraft.value;
  const customTurnMin = source.stageSize === 'custom' ? requiredInteger(source.customTurnMin, '最少轮次') : null;
  const customTurnMax = source.stageSize === 'custom' ? requiredInteger(source.customTurnMax, '最多轮次') : null;
  const customStoryArcVolumeCount = source.storyArcVolumePlan === 'custom'
    ? requiredInteger(source.customStoryArcVolumeCount, '自定义总纲卷数')
    : null;
  if (source.stageSize === 'custom' && (customTurnMin! < 1 || customTurnMax! < customTurnMin! || customTurnMax! > 50)) {
    throw new Error('自定义阶段轮次必须是 1 到 50 的递增整数范围');
  }
  if (source.storyArcVolumePlan === 'custom' && (customStoryArcVolumeCount! < 1 || customStoryArcVolumeCount! > 50)) {
    throw new Error('自定义总纲卷数必须是 1 到 50 的整数');
  }
  const normalized = {
    ...cloneSettings(source),
    customTurnMin,
    customTurnMax,
    customStoryArcVolumeCount,
    maxAutomaticStages: requiredInteger(source.maxAutomaticStages, '自动阶段上限'),
    generationRetryLimit: requiredInteger(source.generationRetryLimit, '正文重试次数'),
    minGenerationTokens: requiredInteger(source.minGenerationTokens, '正文最低 token 数'),
    internalAiRetryLimit: requiredInteger(source.internalAiRetryLimit, '内部 AI 重试次数'),
    loopDelaySeconds: requiredInteger(source.loopDelaySeconds, '轮次延迟'),
    retryDelaySeconds: requiredInteger(source.retryDelaySeconds, '重试延迟'),
    totalDurationMinutes: requiredInteger(source.totalDurationMinutes, '总时长'),
    maxConsecutivePressureTurns: requiredRangeInteger(source.maxConsecutivePressureTurns, '连续高压轮上限', 0, CONTINUATION_MAX_CONSECUTIVE_PRESSURE_TURNS_MAX_UI_ACU),
    storyWindowFloors: requiredInteger(source.storyWindowFloors, '正文可读窗口楼数'),
    storyTailFloors: requiredInteger(source.storyTailFloors, '正文目录尾部全文楼数'),
    agentHistoryTokenBudget: requiredInteger(source.agentHistoryTokenBudget, '会话自动总结阈值'),
    agentReadTokenBudget: normalizedReadBudget(source.agentReadTokenBudget),
    agentReadFallbackTokens: requiredInteger(source.agentReadFallbackTokens, '临近总结时的精读额度'),
    finalReview: {
      enabled: source.finalReview.enabled,
      readTokenBudget: normalizedReadBudget(source.finalReview.readTokenBudget),
      maxExtraReads: requiredRangeInteger(source.finalReview.maxExtraReads, '终审额外读取轮数', 0, 10),
    },
    workflow: {
      autoFixEnabled: source.workflow.autoFixEnabled,
      autoFixMaxAttempts: requiredRangeInteger(source.workflow.autoFixMaxAttempts, '自动修复次数上限', 1, 10),
      reviseLimit: requiredRangeInteger(source.workflow.reviseLimit, '终审打回上限', 1, 10),
      repairMaxExtraReads: requiredRangeInteger(source.workflow.repairMaxExtraReads, '修复额外读取轮数', 0, 10),
    },
    webResearch: {
      enabled: source.webResearch.enabled,
      sources: { ...source.webResearch.sources },
      searchProvider: source.webResearch.searchProvider,
      searxngBaseUrl: String(source.webResearch.searxngBaseUrl ?? '').trim(),
      maxToolRounds: requiredRangeInteger(source.webResearch.maxToolRounds, '网页检索单次工具轮上限', 1, 20),
      maxPages: requiredRangeInteger(source.webResearch.maxPages, '网页检索单次抓取页数上限', 1, 30),
      pageCharLimit: requiredRangeInteger(source.webResearch.pageCharLimit, '网页检索单页阅读字数上限', 500, 20000),
      blockedDomains: String(source.webResearch.blockedDomains ?? ''),
    },
    agentRunBudget: {
      maxIterations: requiredRangeInteger(source.agentRunBudget.maxIterations, '主 Agent 迭代上限', 1, 30),
      maxDelegations: requiredRangeInteger(source.agentRunBudget.maxDelegations, '派工总数上限', 0, 20),
      maxSameAgent: requiredRangeInteger(source.agentRunBudget.maxSameAgent, '单代理派工上限', 1, 10),
      maxConcurrent: requiredRangeInteger(source.agentRunBudget.maxConcurrent, '并发派工上限', 1, 6),
      maxReads: requiredRangeInteger(source.agentRunBudget.maxReads, '读取批次上限', 0, 30),
      maxExtraReads: requiredRangeInteger(source.agentRunBudget.maxExtraReads, '子代理工具轮上限', 0, 10),
    },
  } as ContinuationSettings_ACU;
  if (
    normalized.maxAutomaticStages < 1 || normalized.generationRetryLimit < 0 || normalized.minGenerationTokens < 0
    || normalized.internalAiRetryLimit < 0 || normalized.loopDelaySeconds < 0 || normalized.retryDelaySeconds < 0
    || normalized.totalDurationMinutes < 0 || normalized.storyWindowFloors < 0 || normalized.storyTailFloors < 0
    || normalized.agentHistoryTokenBudget < 0 || normalized.agentReadFallbackTokens < 1
  ) {
    throw new Error('续写设置中的数值不能低于允许范围');
  }
  // TT 通道守卫：启用网页检索时只允许 TT 真实可行的通道组合
  if (normalized.webResearch.enabled && normalized.webResearch.searchProvider !== 'searxng') {
    throw new Error(`搜索引擎选择 ${normalized.webResearch.searchProvider} 时 TT 无法出网：TT 仅提供 /api/search/searxng，请切换为 SearXNG（自建或公共实例）或关闭开场百科检索`);
  }
  if (normalized.webResearch.enabled && normalized.webResearch.sources.baidu) {
    throw new Error('百度百科需要酒馆服务器转发，TT 当前未提供对应路由；请取消勾选百度百科，或关闭开场百科检索');
  }
  if (normalized.webResearch.enabled && normalized.webResearch.searchProvider === 'searxng' && !normalized.webResearch.searxngBaseUrl) {
    throw new Error('搜索引擎选择 SearXNG 时必须填写实例地址');
  }
  if (normalized.apiPresetMode === 'fixed') {
    const presetName = normalized.fixedApiPresetName.trim();
    if (!presetName) throw new Error('固定 API 预设名称不能为空');
    if (!presetExists(presetName)) throw new Error(`API 预设 "${presetName}" 不存在，请重新选择`);
  }
  for (const channel of agentChannelRoles) {
    const choice = normalized.agentApiPresets[channel.role];
    if (choice.mode !== 'fixed') continue;
    const presetName = choice.presetName.trim();
    if (!presetName) throw new Error(`${channel.label} 的固定渠道必须选择预设`);
    if (!presetExists(presetName)) throw new Error(`${channel.label} 渠道的 API 预设 "${presetName}" 不存在，请重新选择`);
  }
  return normalized;
}

/** 最近一次从权威状态装载/保存成功的草稿快照：跳过无变化的自动保存，切断"保存→刷新→重建草稿"循环。 */
let lastPersistedSettingsJson = '';
/**
 * R10B-01：本页自动保存在途时提交的草稿 JSON。保存成功后 runtime.settings 会被刷新成持久化结果；
 * 若期间用户又改了草稿，这次刷新只是自己保存的回声，不得用它重建草稿冲掉新输入。
 */
let inFlightSubmittedDraftJson: string | null = null;
let settingsSaveTimer: ReturnType<typeof setTimeout> | undefined;

/** 设置修改后自动保存（防抖 800ms）。 */
function scheduleSettingsSave(): void {
  if (settingsSaveTimer !== undefined) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => { void saveSettingsNow(); }, 800);
}

/** 立即保存：先取消挂起的防抖计时器。 */
function saveSettingsImmediately(): void {
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
  }
  void saveSettingsNow();
}

async function saveSettingsNow(): Promise<void> {
  if (!settingsDraft.value) return;
  if (!ensureCurrentDraftChat()) return;
  const saveChatIdentity = currentDraftChatIdentity();
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  if (runtime.busy.value) {
    // 有续写操作在执行时不抢租约，稍后重试
    scheduleSettingsSave();
    return;
  }
  let candidate: ContinuationSettings_ACU;
  try {
    apiStore.refreshFromSettings();
    candidate = normalizeSettingsDraft();
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : '续写设置无效';
    return;
  }
  inFlightSubmittedDraftJson = JSON.stringify(settingsDraft.value);
  let outcome: Awaited<ReturnType<typeof runtime.saveSettings>>;
  try {
    outcome = await runtime.saveSettings(candidate);
    // 等保存引起的 runtime.settings 刷新 watch 先跑完，再撤掉在途标记
    await nextTick();
  } finally {
    inFlightSubmittedDraftJson = null;
  }
  if (saveChatIdentity !== currentDraftChatIdentity()) {
    settingsDraft.value = null;
    settingsError.value = '聊天已切换，设置草稿未写入当前聊天。';
    return;
  }
  if (outcome === 'stale') return;
  if (outcome === 'saved') {
    settingsError.value = '';
    settingsNotice.value = '';
    // 保存在途期间的新修改：草稿已被保留，补排一次保存
    if (settingsDraft.value && JSON.stringify(settingsDraft.value) !== lastPersistedSettingsJson) scheduleSettingsSave();
  } else if (outcome === 'busy') {
    settingsNotice.value = '设置已修改：Agent 正在运行，将在本轮空档自动保存并于下一轮生效。';
    scheduleSettingsSave();
  }
}

function promptList(key: PromptKey): ContinuationPromptSegment_ACU[] | null {
  if (!settingsDraft.value) return null;
  if (key === 'outlinePrompt') return settingsDraft.value.outlinePrompt;
  return settingsDraft.value.agentPrompts[key];
}

/** 折叠态摘要：启用段数 / 总段数。 */
function promptGroupMeta(key: PromptKey): string {
  const prompts = promptList(key);
  if (!prompts) return '';
  return `${prompts.filter(segment => segment.enabled !== false).length}/${prompts.length} 段启用`;
}

function addPrompt(key: PromptKey, position: 'top' | 'bottom' = 'bottom'): void {
  const prompts = promptList(key);
  if (!prompts) return;
  const segment: ContinuationPromptSegment_ACU = { role: 'user', content: '请填写提示词内容。', enabled: true, deletable: true };
  if (position === 'top') prompts.unshift(segment);
  else prompts.push(segment);
}

function deletePrompt(key: PromptKey, index: number): void {
  const prompts = promptList(key);
  if (!prompts || prompts[index]?.deletable === false) return;
  prompts.splice(index, 1);
}

function movePrompt(key: PromptKey, index: number, delta: -1 | 1): void {
  const prompts = promptList(key);
  const target = index + delta;
  if (!prompts || target < 0 || target >= prompts.length) return;
  [prompts[index], prompts[target]] = [prompts[target], prompts[index]];
}

function updatePrompt(key: PromptKey, index: number, patch: Partial<ContinuationPromptSegment_ACU>): void {
  const prompts = promptList(key);
  const current = prompts?.[index];
  if (prompts && current) prompts[index] = { ...current, ...patch };
}

function restorePrompt(kind: ContinuationPromptKind_ACU): void {
  if (!settingsDraft.value) return;
  settingsDraft.value = runtime.restorePromptDefault(settingsDraft.value, kind);
}

/** 导出全部提示词（大纲组 + 各 Agent）为 JSON 文件。 */
function exportPrompts(): void {
  if (!settingsDraft.value) return;
  promptIoError.value = '';
  try {
    const source = cloneSettings(settingsDraft.value);
    downloadJsonToHost_ACU('acu-continuation-prompts.json', {
      version: 1,
      outlinePrompt: source.outlinePrompt,
      agentPrompts: source.agentPrompts,
    });
    promptIoNotice.value = '提示词 JSON 已导出。';
  } catch (error) {
    promptIoError.value = error instanceof Error ? error.message : '提示词导出失败。';
  }
}

/** 导入提示词 JSON：逐组校验通过后整体写入草稿并立即保存；任一组失败即整体拒绝。 */
async function onImportPromptsFile(file: File): Promise<void> {
  if (!settingsDraft.value) return;
  promptIoError.value = '';
  promptIoNotice.value = '';
  try {
    const bundle = runtime.parsePromptBundle(await readFileText_UB(file));
    settingsDraft.value.outlinePrompt = bundle.outlinePrompt;
    settingsDraft.value.agentPrompts = bundle.agentPrompts;
    saveSettingsImmediately();
    promptIoNotice.value = '提示词 JSON 已导入并保存。';
  } catch (error) {
    promptIoError.value = error instanceof Error ? error.message : '提示词 JSON 读取失败。';
  }
}

function refreshAll(): void {
  apiStore.refreshFromSettings();
  runtime.refresh();
  // 会话流是全局内存：切聊天必须清空并从新聊天的持久会话回灌
  session.rehydrate();
}

/** 楼层被删除 / swipe 后：任务游标、会话与资料都锚定在楼层上，必须重读。 */
function refreshAfterChatMutation(): void {
  runtime.refresh();
  session.resyncAfterChatMutation();
  materialsPanel.value?.reload();
}

onMounted(() => {
  apiStore.refreshFromSettings();
  void runtime.initialize();
});

onBeforeUnmount(() => {
  stopCountdownTimer();
  // 防抖窗口内离开页面时冲刷一次未落盘的改动
  if (settingsSaveTimer !== undefined) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
    void saveSettingsNow();
  }
});

watchChatChanged_ACU(() => {
  const nextIdentity = currentDraftChatIdentity();
  if (nextIdentity !== draftChatIdentity.value) {
    messageDraft.value = '';
    outlineDraft.value = '';
    settingsDraft.value = null;
    settingsError.value = '';
    settingsNotice.value = '聊天已切换，旧草稿已清空；请重新载入当前聊天。';
    lastPersistedSettingsJson = '';
    draftChatIdentity.value = nextIdentity;
  }
  refreshAll();
});

watch(useChatMutationTick(), refreshAfterChatMutation);

watch([runtimeSettingsIdentity, runtime.settings], ([sourceIdentity, settings]) => {
  // settings 与聊天身份一起提交：迟到的 A 结果不得重建 B 的草稿
  const identity = String(sourceIdentity ?? currentDraftChatIdentity());
  if (identity !== currentDraftChatIdentity() || identity !== draftChatIdentity.value) return;
  // 只有持久化内容真的变了才重建草稿，否则运行期间的刷新会冲掉未保存的改动
  const persistedJson = settings ? JSON.stringify(cloneSettings(settings)) : '';
  if (persistedJson === lastPersistedSettingsJson && settingsDraft.value) return;
  if (
    inFlightSubmittedDraftJson !== null
    && settingsDraft.value
    && JSON.stringify(settingsDraft.value) !== inFlightSubmittedDraftJson
  ) {
    lastPersistedSettingsJson = persistedJson;
    return;
  }
  settingsDraft.value = settings ? cloneSettings(settings) : null;
  lastPersistedSettingsJson = persistedJson;
}, { immediate: true });

watch(settingsDraft, () => {
  if (!settingsDraft.value) return;
  if (JSON.stringify(settingsDraft.value) === lastPersistedSettingsJson) return;
  scheduleSettingsSave();
}, { deep: true });

watch(() => `${runtime.activeStage.value?.stageId ?? ''}:${runtime.activeRevision.value?.revision ?? ''}`, syncOutlineDraft, { immediate: true });
</script>

<style scoped>
.ub-cont__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--ub-s2);
}

.ub-cont__error {
  color: var(--ub-danger);
  font-size: var(--ub-fs-xs);
}

.ub-cont__notice {
  color: var(--ub-warn);
  font-size: var(--ub-fs-xs);
  font-weight: 600;
}

.ub-cont__pad {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4) 0;
}

.ub-cont__groups {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s3) var(--ub-s4) var(--ub-s4);
  border-top: 1px solid var(--ub-line-soft);
}

.ub-cont__groups :deep(.ub-row) {
  padding-left: 0;
  padding-right: 0;
}

.ub-cont__meta {
  color: var(--ub-text-3);
  font-size: var(--ub-fs-xs);
  line-height: 1.6;
}

.ub-cont__checks {
  display: flex;
  flex-direction: column;
  gap: var(--ub-s2);
  padding: var(--ub-s2) 0;
}

.ub-cont__subhead {
  margin: var(--ub-s2) 0 0;
  color: var(--ub-text);
  font-size: var(--ub-fs-sm);
  font-weight: 700;
}
</style>
