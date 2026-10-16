<template>
  <!-- 天球数据库：数据库圆柱外绕一圈星轨，轨道上一颗小行星，右上一颗四芒星（取意天体科） -->
  <span class="ub-brand__mark" aria-hidden="true">
    <svg class="ub-mark" viewBox="0 0 160 160" focusable="false">
      <path class="ub-mark__line" d="M40 52 L40 108 A40 12 0 0 0 120 108 L120 52" />
      <ellipse class="ub-mark__line" cx="80" cy="52" rx="40" ry="12" />
      <path class="ub-mark__line ub-mark__layer" d="M40 80 A40 12 0 0 0 120 80" />
      <ellipse class="ub-mark__orbit" cx="80" cy="82" rx="68" ry="20" transform="rotate(-16 80 82)" />
      <path class="ub-mark__star" d="M126 12 Q129 28 145 31 Q129 34 126 50 Q123 34 107 31 Q123 28 126 12Z" />
      <circle class="ub-mark__planet" cx="26.2" cy="107.8" r="9" />
    </svg>
  </span>
</template>

<style scoped>
.ub-brand__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: calc(var(--ub-u) * 36);
  height: calc(var(--ub-u) * 36);
  border-radius: 11px;
  background: #1b2340;
}

.ub-mark {
  display: block;
  width: 78%;
  height: 78%;
  overflow: visible;
}

.ub-mark__line,
.ub-mark__orbit {
  fill: none;
  stroke-width: var(--ub-mark-stroke, calc(var(--ub-u) * 1.5));
  vector-effect: non-scaling-stroke;
}

.ub-mark__line {
  stroke: var(--ub-mark-line, #dfe6ff);
}

.ub-mark__layer {
  stroke-opacity: 0.6;
}

.ub-mark__orbit {
  stroke: var(--ub-mark-orbit, #e8c372);
}

.ub-mark__planet {
  fill: var(--ub-mark-orbit, #e8c372);
}

.ub-mark__star {
  fill: var(--ub-mark-star, #f6f1e2);
}
</style>
