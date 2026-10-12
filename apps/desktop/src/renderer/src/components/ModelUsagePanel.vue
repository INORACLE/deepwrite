<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type {
  ModelUsageDashboard,
  ModelUsageQueryInput
} from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import ModelAnnouncementNotice from "./ModelAnnouncementNotice.vue";
import { useModelUsagePanel } from "../composables/useModelUsagePanel";

const t = createScopedTranslator("components.modelUsagePanel");

const props = defineProps<{
  dashboard: ModelUsageDashboard | null;
  loading: boolean;
  modelAlertMessages: readonly string[];
}>();
const emit = defineEmits<{
  query: [input: ModelUsageQueryInput];
  openOfficialModels: [];
}>();
const {
  isEmpty,
  hasModels,
  showDashboard,
  selectedRange,
  rangeLabel,
  moduleRows,
  trendChartPoints,
  trendLinePath,
  trendAreaPath,
  trendStartLabel,
  trendEndLabel,
  trendAccessibleLabel,
  selectRange,
  refresh,
  formatTokens,
  formatTrendBucket,
  formatDateTime,
  moduleLabel,
  moduleDetail,
  modulePercentage,
  modelStatusLabel,
  modelProviderLabel,
  modelBadgeLabel,
  actorLabel,
  callStatusLabel,
  RANGE_OPTIONS,
  CHART_WIDTH,
  CHART_HEIGHT,
  CHART_PADDING_X,
  CHART_PADDING_TOP,
  CHART_PADDING_BOTTOM
} = useModelUsagePanel(props, emit);
</script>

<template>
  <section class="model-usage-panel" aria-labelledby="model-usage-title">
    <header class="usage-header">
      <div class="usage-heading">
        <span class="usage-kicker"
          ><AppIcon name="ledger" :size="15" />
          {{ t("localUsageLedger") }}</span
        >
        <h2 id="model-usage-title">
          {{ t("modelUsage") }}
        </h2>
        <ModelAnnouncementNotice
          class="usage-notice"
          :messages="modelAlertMessages"
          @open-official-models="emit('openOfficialModels')"
        />
      </div>
      <button
        type="button"
        class="usage-refresh"
        :disabled="loading"
        :aria-busy="loading"
        :aria-label="loading ? t('refreshingUsage') : t('refreshUsage')"
        @click="refresh"
      >
        <AppIcon
          name="history"
          :size="15"
          class="usage-refresh-icon"
          :class="{ 'is-loading': loading }"
        />
        {{ t("refresh") }}
      </button>
    </header>

    <div class="usage-toolbar" role="toolbar" :aria-label="t('usageDateRange')">
      <span>{{ t("dateRange") }}</span>
      <div
        class="usage-range-options"
        role="group"
        :aria-label="t('selectDateRange')"
      >
        <button
          v-for="option in RANGE_OPTIONS"
          :key="option.id"
          type="button"
          class="usage-range-option"
          :class="{ 'is-active': selectedRange === option.id }"
          :aria-pressed="selectedRange === option.id"
          @click="selectRange(option.id)"
        >
          {{ option.label }}
        </button>
      </div>
      <span v-if="dashboard" class="usage-updated-at">
        {{
          t("updatedMessage", {
            arg0: formatDateTime(dashboard.generatedAt) ?? ""
          })
        }}
      </span>
    </div>

    <div
      v-if="loading && !dashboard"
      class="usage-state is-loading"
      aria-live="polite"
    >
      <span class="usage-spinner" aria-hidden="true" />
      <strong>{{ t("readingLocalUsage") }}</strong>
      <p>
        {{ t("summarizingModelAndModuleUsage") }}
      </p>
    </div>

    <div v-else-if="!dashboard" class="usage-state">
      <AppIcon name="ledger" :size="24" />
      <strong>{{ t("usageDataHasNotLoaded") }}</strong>
      <p>{{ t("refreshAndTryAgain") }}</p>
      <button type="button" class="usage-refresh" @click="refresh">
        {{ t("refreshUsage") }}
      </button>
    </div>

    <div v-else-if="isEmpty && !hasModels" class="usage-state">
      <AppIcon name="sparkles" :size="24" />
      <strong>{{ t("noModelUsageYet") }}</strong>
      <p>
        {{ t("futureModelCallsWillBeTrackedAutomaticallyAndStored") }}
      </p>
    </div>

    <div v-else-if="showDashboard && dashboard" class="usage-dashboard">
      <section class="usage-summary-grid" :aria-label="t('usageSummary')">
        <article class="usage-summary-card is-total">
          <span>{{ t("totalTokens") }}</span>
          <strong>{{ formatTokens(dashboard.totals.totalTokens) }}</strong>
          <small>{{
            t("modelRequestsMessage", {
              arg0: formatTokens(dashboard.totals.requestCount) ?? ""
            })
          }}</small>
        </article>
        <article class="usage-summary-card">
          <span>{{ t("inputTokens") }}</span>
          <strong>{{ formatTokens(dashboard.totals.inputTokens) }}</strong>
          <small>{{ t("contextSentToTheModel") }}</small>
        </article>
        <article class="usage-summary-card">
          <span>{{ t("outputTokens") }}</span>
          <strong>{{ formatTokens(dashboard.totals.outputTokens) }}</strong>
          <small>{{ t("contentGeneratedByTheModel") }}</small>
        </article>
        <article class="usage-summary-card">
          <span>{{ t("cacheTokens") }}</span>
          <strong>{{
            formatTokens(
              dashboard.totals.cacheReadTokens +
                dashboard.totals.cacheWriteTokens
            )
          }}</strong>
          <small>{{
            t("readWriteMessage", {
              arg0: formatTokens(dashboard.totals.cacheReadTokens) ?? "",
              arg1: formatTokens(dashboard.totals.cacheWriteTokens) ?? ""
            })
          }}</small>
        </article>
      </section>

      <section
        class="usage-card usage-trend-card"
        aria-labelledby="usage-trend-title"
      >
        <header class="usage-card-header">
          <div>
            <span>{{ t("trend") }}</span>
            <h3 id="usage-trend-title">
              {{
                t("totalTokensMessage", {
                  arg0: rangeLabel ?? ""
                })
              }}
            </h3>
          </div>
          <strong>{{ formatTokens(dashboard.totals.totalTokens) }}</strong>
        </header>
        <div v-if="trendChartPoints.length" class="usage-trend-chart">
          <svg
            :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`"
            preserveAspectRatio="none"
            role="img"
            :aria-label="trendAccessibleLabel"
          >
            <title>{{ trendAccessibleLabel }}</title>
            <line
              v-for="position in [0.2, 0.5, 0.8]"
              :key="position"
              class="usage-chart-gridline"
              :x1="CHART_PADDING_X"
              :x2="CHART_WIDTH - CHART_PADDING_X"
              :y1="
                CHART_PADDING_TOP +
                (CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM) *
                  position
              "
              :y2="
                CHART_PADDING_TOP +
                (CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM) *
                  position
              "
            />
            <path class="usage-chart-area" :d="trendAreaPath" />
            <path class="usage-chart-line" :d="trendLinePath" />
            <circle
              v-for="point in trendChartPoints"
              :key="point.bucketStart"
              class="usage-chart-point"
              :cx="point.x"
              :cy="point.y"
              r="2.8"
            >
              <title>
                {{
                  `${formatTrendBucket(point.bucketStart)}：${formatTokens(point.value)} Token`
                }}
              </title>
            </circle>
          </svg>
          <div class="usage-chart-dates" aria-hidden="true">
            <span>{{ formatTrendBucket(trendStartLabel) }}</span>
            <span>{{ formatTrendBucket(trendEndLabel) }}</span>
          </div>
        </div>
        <div v-else class="usage-chart-empty">
          {{ t("noTrendDataForThisDateRange") }}
        </div>
      </section>

      <div class="usage-detail-grid">
        <section
          class="usage-card usage-module-card"
          aria-labelledby="usage-module-title"
        >
          <header class="usage-card-header">
            <div>
              <span>{{ t("module") }}</span>
              <h3 id="usage-module-title">
                {{ t("usageByModule") }}
              </h3>
            </div>
            <AppIcon name="sparkles" :size="17" />
          </header>
          <div v-if="moduleRows.length" class="usage-module-list">
            <div
              v-for="item in moduleRows"
              :key="item.module"
              class="usage-module-row"
            >
              <div class="usage-module-name">
                <strong>{{ moduleLabel(item.module) }}</strong>
                <small>{{ moduleDetail(item.module) }}</small>
              </div>
              <div class="usage-module-value">
                <strong>{{ formatTokens(item.totals.totalTokens) }}</strong>
                <small>{{
                  t("requestsMessage", {
                    arg0: formatTokens(item.totals.requestCount) ?? ""
                  })
                }}</small>
              </div>
              <div class="usage-module-track" aria-hidden="true">
                <span
                  :style="{ width: modulePercentage(item.totals.totalTokens) }"
                />
              </div>
            </div>
          </div>
          <p v-else class="usage-inline-empty">
            {{ t("noModuleUsageInThisDateRange") }}
          </p>
        </section>

        <section
          class="usage-card usage-model-card"
          aria-labelledby="usage-model-title"
        >
          <header class="usage-card-header">
            <div>
              <span>{{ t("model") }}</span>
              <h3 id="usage-model-title">
                {{ t("modelStatus") }}
              </h3>
            </div>
            <AppIcon name="model" :size="17" />
          </header>
          <div class="usage-model-table-wrap">
            <table class="usage-model-table">
              <thead>
                <tr>
                  <th scope="col">
                    {{ t("model") }}
                  </th>
                  <th scope="col">
                    {{ t("status") }}
                  </th>
                  <th scope="col">
                    {{ t("totalTokens") }}
                  </th>
                  <th scope="col">
                    {{ t("calls") }}
                  </th>
                  <th scope="col">
                    {{ t("lastUsed") }}
                  </th>
                </tr>
              </thead>
              <tbody v-if="dashboard.models.length">
                <tr
                  v-for="item in dashboard.models"
                  :key="`${item.model.configId}:${item.model.revisionId}`"
                >
                  <td>
                    <div class="usage-model-identity">
                      <span class="usage-model-badge" aria-hidden="true">{{
                        modelBadgeLabel(item.model)
                      }}</span>
                      <span>
                        <strong>{{ item.model.label }}</strong>
                        <small
                          >{{ modelProviderLabel(item.model) }} ·
                          {{ item.model.modelId }}</small
                        >
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      class="usage-model-status"
                      :class="`is-${item.status}`"
                    >
                      <i aria-hidden="true" />{{
                        modelStatusLabel(item.status)
                      }}
                    </span>
                  </td>
                  <td>
                    <strong>{{ formatTokens(item.totals.totalTokens) }}</strong>
                    <small>{{
                      t("inOutMessage", {
                        arg0: formatTokens(item.totals.inputTokens) ?? "",
                        arg1: formatTokens(item.totals.outputTokens) ?? ""
                      })
                    }}</small>
                  </td>
                  <td>{{ formatTokens(item.totals.requestCount) }}</td>
                  <td>
                    <time v-if="item.lastUsedAt" :datetime="item.lastUsedAt">
                      {{ formatDateTime(item.lastUsedAt) }}
                    </time>
                    <span v-else class="usage-model-unused">{{
                      t("unused")
                    }}</span>
                  </td>
                </tr>
              </tbody>
              <tbody v-else>
                <tr>
                  <td colspan="5" class="usage-table-empty">
                    {{ t("noModelRecordsInThisDateRange") }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section
        class="usage-card usage-recent-card"
        aria-labelledby="usage-recent-title"
      >
        <header class="usage-card-header">
          <div>
            <span>{{ t("callDetails") }}</span>
            <h3 id="usage-recent-title">
              {{ t("recentCalls") }}
            </h3>
          </div>
          <small>{{
            t("showingEntriesUpToRetainedLocallyMessage", {
              arg0: dashboard.recentCalls.length ?? ""
            })
          }}</small>
        </header>
        <div class="usage-model-table-wrap">
          <table class="usage-model-table usage-recent-table">
            <thead>
              <tr>
                <th scope="col">{{ t("time") }}</th>
                <th scope="col">{{ t("model") }}</th>
                <th scope="col">
                  {{ t("module") }}
                </th>
                <th scope="col">
                  {{ t("caller") }}
                </th>
                <th scope="col">
                  {{ t("status") }}
                </th>
                <th scope="col">Token</th>
              </tr>
            </thead>
            <tbody v-if="dashboard.recentCalls.length">
              <tr
                v-for="(call, index) in dashboard.recentCalls"
                :key="`${call.occurredAt}:${call.model.configId}:${index}`"
              >
                <td>
                  <time :datetime="call.occurredAt">{{
                    formatDateTime(call.occurredAt)
                  }}</time>
                </td>
                <td>
                  <strong>{{ call.model.label }}</strong>
                  <small
                    >{{ modelProviderLabel(call.model) }} ·
                    {{ call.model.modelId }}</small
                  >
                </td>
                <td>{{ moduleLabel(call.module) }}</td>
                <td>{{ actorLabel(call.actor) }}</td>
                <td>
                  <span class="usage-call-status" :class="`is-${call.status}`">
                    {{ callStatusLabel(call.status) }}
                  </span>
                </td>
                <td>
                  <strong>{{ formatTokens(call.usage.totalTokens) }}</strong>
                  <small>
                    {{
                      t("inOutCacheMessage", {
                        arg0: formatTokens(call.usage.inputTokens) ?? "",
                        arg1: formatTokens(call.usage.outputTokens) ?? "",
                        arg2:
                          formatTokens(
                            call.usage.cacheReadTokens +
                              call.usage.cacheWriteTokens
                          ) ?? ""
                      })
                    }}
                  </small>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr>
                <td colspan="6" class="usage-table-empty">
                  {{ t("noModelCallDetailsYet") }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped src="./model-usage-panel.css"></style>
