<template>
  <section class="acu-v2-biotracker-page">
    <AcuMobilePanelNav :items="panelNavItems" />

    <div class="acu-v2-biotracker-page__panel-stack">
      <!-- API 设置（参照剧情推进：API 预设选择） -->
      <AcuPanel
        id="biotracker-api-panel"
        :title="copy.apiTitle"
        :description="copy.apiDescription"
      >
        <AcuFormRow label="生理追踪 API 预设" hint="默认使用当前的API，选择后仅影响生理追踪功能。">
          <AcuSelect
            :options="apiPresetSelectOptions"
            :model-value="apiPreset"
            :placeholder="followActiveApiLabel"
            @update:model-value="setApiPreset"
          />
        </AcuFormRow>
        <p class="acu-v2-biotracker-page__api-readonly">
          当前生效：{{ apiUrl ? apiUrl : '未配置 URL' }} / {{ apiModel ? apiModel : '未配置模型' }}
        </p>
      </AcuPanel>

      <!-- 手动注册 -->
      <AcuPanel
        id="biotracker-register-panel"
        :title="copy.registerTitle"
        :description="copy.registerDescription"
      >
        <AcuFormRow label="角色名">
          <input v-model="registerName" type="text" class="acu-input" placeholder="要注册的角色名" />
        </AcuFormRow>
        <AcuFormRow label="种族（留空则由 AI 判断）">
          <select v-model="registerRace" class="acu-input">
            <option value="">（由 AI 判断）</option>
            <option v-for="race in registerRaceOptions" :key="race" :value="race">{{ race }}</option>
          </select>
        </AcuFormRow>
        <AcuFormRow label="补充设定（可选）">
          <textarea v-model="registerNotes" class="acu-input" rows="2" placeholder="种族生理/心理/描述补充"></textarea>
        </AcuFormRow>
        <AcuFormRow label="发送最近 N 条 AI 回复" hint="注册/推演分析发送给 AI 的最近 AI 回复条数">
          <input v-model.number="registerRecentCount" type="number" min="1" max="100" class="acu-input" @change="setRegisterRecentCount(registerRecentCount)" />
        </AcuFormRow>
        <div class="acu-v2-biotracker-page__actions">
          <AcuButton size="sm" :disabled="registering" @click="doRegister">
            {{ registering ? '注册中...' : '注册角色' }}
          </AcuButton>
          <AcuButton size="sm" variant="secondary" :disabled="wardrobeGenerating" @click="generateWardrobe(false)">
            {{ wardrobeGenerating ? '生成中...' : '生成备装' }}
          </AcuButton>
          <AcuButton size="sm" variant="secondary" :disabled="wardrobeGenerating" @click="generateWardrobe(true)">
            {{ wardrobeGenerating ? '生成中...' : '增强生成备装' }}
          </AcuButton>
        </div>
        <p class="acu-v2-biotracker-page__api-readonly">
          增强生成备装会把内置服装风格世界书一并发送给 AI（更贴合当前世界观的着装）。
        </p>
        <p v-if="status" class="acu-v2-biotracker-page__status" :data-error="statusIsError">
          {{ status }}
        </p>
      </AcuPanel>

      <!-- 自动注册 -->
      <AcuPanel
        id="biotracker-auto-panel"
        :title="copy.autoTitle"
        :description="copy.autoDescription"
      >
        <AcuToggle :model-value="autoRegister" label="自动注册" @update:model-value="toggleAutoRegister" />
        <AcuFormRow label="更新频率" hint="每几层新楼层送入一次分析">
          <select v-model="autoFrequency" class="acu-input" @change="setAutoFrequency(autoFrequency)">
            <option v-for="freq in autoFrequencyOptions" :key="freq" :value="freq">每 {{ freq }} 层</option>
          </select>
        </AcuFormRow>
        <div class="acu-v2-biotracker-page__actions">
          <AcuButton size="sm" :disabled="autoRunning || !autoRegister" @click="runAutoRegister">
            {{ autoRunning ? '分析中...' : '立即分析并注册' }}
          </AcuButton>
        </div>
        <AcuFormRow label="发送最近 N 条 AI 回复" hint="手动点击「立即分析并注册」时，发送给 AI 的最近 AI 回复条数">
          <input v-model.number="autoRecentCount" type="number" min="1" max="100" class="acu-input" @change="setAutoRecentCount(autoRecentCount)" />
        </AcuFormRow>
        <p class="acu-v2-biotracker-page__api-readonly">
          {{ autoRegister ? '已开启：最新楼层达到更新频率后自动送入分析。' : '关闭状态：仅可手动点击「立即分析并注册」。' }}
        </p>
      </AcuPanel>

      <!-- 已注册角色（只读） -->
      <AcuPanel
        id="biotracker-data-panel"
        :title="copy.dataTitle"
        :description="copy.dataDescription"
      >
        <div v-if="characters.length === 0" class="acu-v2-biotracker-page__empty">
          当前聊天尚未注册角色。请先注册，或开启自动注册后发送消息等待发现。
        </div>
        <table v-else class="acu-v2-biotracker-page__table">
          <thead>
            <tr>
              <th>角色名</th>
              <th>种族</th>
              <th>状态</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in characters" :key="c.name">
              <td>{{ c.name }}</td>
              <td>{{ c.race }}</td>
              <td>{{ c.summary }}</td>
              <td>
                <AcuButton size="xs" variant="secondary" @click="viewFullState(c.name)">
                  {{ selectedFullStateName === c.name ? '已选中' : '完整变量' }}
                </AcuButton>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="selectedFullStateName" class="acu-v2-biotracker-page__fullstate">
          <div class="acu-v2-biotracker-page__fullstate-title">
            完整变量：{{ selectedFullStateName }}
            <AcuButton size="xs" variant="secondary" @click="viewFullState(selectedFullStateName)">刷新</AcuButton>
          </div>
          <p v-if="fullStateError" class="acu-v2-biotracker-page__status" data-error="true">{{ fullStateError }}</p>
          <pre v-else class="acu-v2-biotracker-page__fullstate-json">{{ fullStateJson }}</pre>

          <div class="acu-v2-biotracker-page__fullstate-debug">
            <div class="acu-v2-biotracker-page__fullstate-title">调试工具</div>
            <div class="acu-v2-biotracker-page__actions">
              <AcuButton size="xs" variant="secondary" :disabled="debugBusy" @click="runDebugAction('bsSetCharacterPresence', { isPresent: false })">标记离场</AcuButton>
              <AcuButton size="xs" variant="secondary" :disabled="debugBusy" @click="runDebugAction('bsSetCharacterPresence', { isPresent: true })">标记在场</AcuButton>
              <AcuButton size="xs" variant="secondary" :disabled="debugBusy" @click="runDebugAction('bsDebugClearContainers', { container: 'sperms' })">清空精液</AcuButton>
              <AcuButton size="xs" variant="secondary" :disabled="debugBusy" @click="runDebugAction('bsDebugClearContainers', { container: 'fetuses' })">清空胎儿</AcuButton>
              <AcuButton size="xs" variant="secondary" :disabled="debugBusy" @click="runDebugAction('bsDebugClearContainers', { container: 'children' })">清空孩子</AcuButton>
            </div>
            <p v-if="debugMessage" class="acu-v2-biotracker-page__status" :data-error="!debugMessage.includes('完成') && debugMessage.includes('失败')">
              {{ debugMessage }}
            </p>
          </div>
        </div>
        <div class="acu-v2-biotracker-page__actions">
          <AcuButton size="sm" :disabled="tracking" @click="runTrackerNow">
            {{ tracking ? '分析中...' : '立即追踪分析' }}
          </AcuButton>
          <AcuButton size="sm" variant="secondary" @click="clearChatState">
            清空本聊天数据（恢复初始）
          </AcuButton>
        </div>
      </AcuPanel>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AcuMobilePanelNav from '../components/_lib/AcuMobilePanelNav.vue';
import AcuPanel from '../components/_lib/AcuPanel.vue';
import AcuFormRow from '../components/_lib/AcuFormRow.vue';
import AcuSelect from '../components/_lib/AcuSelect.vue';
import AcuButton from '../components/_lib/AcuButton.vue';
import AcuToggle from '../components/_lib/AcuToggle.vue';
import { useBiotrackerPage } from '../composables/useBiotrackerPage';

const copy = {
  apiTitle: 'API 设置',
  apiDescription: '生理追踪/注册默认使用数据库当前活动 API；可为本页选择专用 API 预设（与剧情推进一致）。需支持 OpenAI 兼容 /chat/completions 并能稳定输出 JSON。',
  registerTitle: '手动注册',
  registerDescription: '填写角色名（可选手动种族）后点击「注册角色」，一次点击即依次执行「繁育推演 + 注册」两次调用。',
  autoTitle: '自动注册',
  autoDescription: '开启后由配置的模型读取正文，自动发现有价值的角色并注册（种族交 AI 判断）。',
  dataTitle: '已注册角色',
  dataDescription: '当前聊天的生理追踪数据（只读）。完整数据由异步追踪持续更新。',
};

const {
  apiPreset,
  setApiPreset,
  apiPresetSelectOptions,
  followActiveApiLabel,
  apiUrl,
  apiKey,
  apiModel,
  registerName,
  registerRace,
  registerNotes,
  registerRecentCount,
  setRegisterRecentCount,
  registerRaceOptions,
  registering,
  doRegister,
  autoRegister,
  toggleAutoRegister,
  autoFrequency,
  setAutoFrequency,
  autoFrequencyOptions,
  autoRecentCount,
  setAutoRecentCount,
  autoRunning,
  tracking,
  runAutoRegister,
  runTrackerNow,
  clearChatState,
  generateWardrobe,
  wardrobeGenerating,
  selectedFullStateName,
  fullStateJson,
  fullStateError,
  debugBusy,
  debugMessage,
  viewFullState,
  runDebugAction,
  characters,
  status,
  statusIsError,
} = useBiotrackerPage();

const panelNavItems = computed(() => [
  { id: 'biotracker-api-panel', label: copy.apiTitle },
  { id: 'biotracker-register-panel', label: copy.registerTitle },
  { id: 'biotracker-auto-panel', label: copy.autoTitle },
  { id: 'biotracker-data-panel', label: copy.dataTitle },
]);
</script>

<style scoped>
.acu-v2-biotracker-page {
  min-height: 100%;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.acu-v2-biotracker-page__panel-stack {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.acu-v2-biotracker-page__api-readonly {
  color: var(--acu-text-2, inherit);
  margin: 0;
  line-height: 1.55;
}
.acu-v2-biotracker-page__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}
.acu-v2-biotracker-page__toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}
.acu-v2-biotracker-page__status {
  margin-top: 0.75rem;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  background: rgba(125, 73, 64, 0.12);
  color: var(--acu-text, inherit);
}
.acu-v2-biotracker-page__status[data-error='true'] {
  background: rgba(220, 60, 60, 0.15);
  color: #e06060;
}
.acu-v2-biotracker-page__empty {
  color: var(--acu-text-dim, #8a8075);
  padding: 0.5rem 0;
}
.acu-v2-biotracker-page__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.acu-v2-biotracker-page__table th,
.acu-v2-biotracker-page__table td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
.acu-v2-biotracker-page__fullstate {
  margin-top: 0.75rem;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  padding-top: 0.75rem;
}
.acu-v2-biotracker-page__fullstate-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  margin-bottom: 0.4rem;
  gap: 0.5rem;
}
.acu-v2-biotracker-page__fullstate-json {
  max-height: 260px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 0.5rem;
  font-size: 0.78em;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.acu-v2-biotracker-page__fullstate-debug {
  margin-top: 0.75rem;
}
</style>
