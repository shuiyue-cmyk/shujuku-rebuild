#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# 三层架构护栏检查（全维度）
#
# 不只检查 import 方向，还检查函数体里的越权行为。
# 构建时自动运行，任何一项不过就构建失败。
# ═══════════════════════════════════════════════════════════════

cd "$(dirname "$0")/.." || exit 1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

total=0

echo "═══════════════════════════════════════════════════"
echo "  三层架构护栏检查（全维度）"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 第一部分：import 方向检查（原有） ──

echo "── Import 方向检查 ──"
echo ""

# 1) service → presentation
count=$(grep -rn "from '.*presentation" src/service/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service → presentation: $count 条${NC}"
  grep -rn "from '.*presentation" src/service/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service → presentation: 0 条${NC}"
fi

# 2) data → service
count=$(grep -rn "from '.*service" src/data/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] data → service: $count 条${NC}"
  grep -rn "from '.*service" src/data/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] data → service: 0 条${NC}"
fi

# 3) data → presentation
count=$(grep -rn "from '.*presentation" src/data/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] data → presentation: $count 条${NC}"
  grep -rn "from '.*presentation" src/data/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] data → presentation: 0 条${NC}"
fi

# 4) presentation → data
count=$(grep -rn "from '.*data/" src/presentation/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] presentation → data: $count 条${NC}"
  grep -rn "from '.*data/" src/presentation/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] presentation → data: 0 条${NC}"
fi

# 5) shared → service
count=$(grep -rn "from '.*service" src/shared/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] shared → service: $count 条${NC}"
  grep -rn "from '.*service" src/shared/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] shared → service: 0 条${NC}"
fi

# 6) shared → data
count=$(grep -rn "from '.*data/" src/shared/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] shared → data: $count 条${NC}"
  grep -rn "from '.*data/" src/shared/ --include='*.ts' --include='*.js' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] shared → data: 0 条${NC}"
fi

echo ""

# ── 第二部分：service 层 UI 越权检查 ──

echo "── Service 层 UI 越权检查 ──"
echo ""

# S-1) service 层调用 showToastr（排除 toast-service.ts 的定义处）
count=$(grep -rn "showToastr_ACU(" src/service/ --include='*.ts' 2>/dev/null | grep -v 'toast-service.ts' | grep -v '// arch-ok' | grep -v 'export function showToastr' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 showToastr 调用: $count 处${NC}"
  grep -rn "showToastr_ACU(" src/service/ --include='*.ts' 2>/dev/null | grep -v 'toast-service.ts' | grep -v '// arch-ok' | grep -v 'export function showToastr'
else
  echo -e "${GREEN}[PASS] service 层 showToastr 调用: 0 处${NC}"
fi

# S-2) service 层调用 toastr_API_ACU.clear/remove（排除 toast-service.ts）
count=$(grep -rn "toastr_API_ACU\." src/service/ --include='*.ts' 2>/dev/null | grep -v 'toast-service.ts' | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 toastr_API 直接操作: $count 处${NC}"
  grep -rn "toastr_API_ACU\." src/service/ --include='*.ts' 2>/dev/null | grep -v 'toast-service.ts' | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service 层 toastr_API 直接操作: 0 处${NC}"
fi

# S-3) service 层调用 _notifyTableUpdate
count=$(grep -rn "_notifyTableUpdate" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 _notifyTableUpdate: $count 处${NC}"
  grep -rn "_notifyTableUpdate" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service 层 _notifyTableUpdate: 0 处${NC}"
fi

# S-4) service 层调用 ACU_Visualizer_Refresh / ACU_WindowManager
count=$(grep -rn "ACU_Visualizer_Refresh\|ACU_WindowManager" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 Visualizer/WindowManager 操作: $count 处${NC}"
  grep -rn "ACU_Visualizer_Refresh\|ACU_WindowManager" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service 层 Visualizer/WindowManager 操作: 0 处${NC}"
fi

# S-5) service 层使用 jQuery DOM 操作（.find( .on( .off( .append( .empty( .html( .val( .css(）
# 排除 .find(e => 这类数组操作（后面跟箭头函数），只匹配 jQuery 风格的 .find('xxx')
count=$(grep -rn '\.find(\x27\|\.find("\|\.find(`\|\.on(\x27\|\.on("\|\.off(\x27\|\.off("\|\.append(\|\.empty(\|\.addClass(\|\.removeClass(' src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | grep -v 'toast-service.ts' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 jQuery DOM 操作: $count 处${NC}"
  grep -rn '\.find(\x27\|\.find("\|\.find(`\|\.on(\x27\|\.on("\|\.off(\x27\|\.off("\|\.append(\|\.empty(\|\.addClass(\|\.removeClass(' src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | grep -v 'toast-service.ts'
else
  echo -e "${GREEN}[PASS] service 层 jQuery DOM 操作: 0 处${NC}"
fi

# S-6) service 层使用 document.createElement / document.getElementById
count=$(grep -rn "document\.createElement\|document\.getElementById\|document\.querySelector" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | grep -v 'toast-service.ts' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 DOM API: $count 处${NC}"
  grep -rn "document\.createElement\|document\.getElementById\|document\.querySelector" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | grep -v 'toast-service.ts'
else
  echo -e "${GREEN}[PASS] service 层 DOM API: 0 处${NC}"
fi

# S-7) service 层使用 addEventListener
count=$(grep -rn "addEventListener" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 addEventListener: $count 处${NC}"
  grep -rn "addEventListener" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service 层 addEventListener: 0 处${NC}"
fi

# S-8) service 层使用 .innerHTML
count=$(grep -rn "\.innerHTML" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 .innerHTML: $count 处${NC}"
  grep -rn "\.innerHTML" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service 层 .innerHTML: 0 处${NC}"
fi

# S-9) service 层 eventSource.emit（service 主动触发宿主 UI 事件）
count=$(grep -rn "eventSource\.emit" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] service 层 eventSource.emit（主动触发 UI 事件）: $count 处${NC}"
  grep -rn "eventSource\.emit" src/service/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] service 层 eventSource.emit: 0 处${NC}"
fi

echo ""

# ── 第三部分：data 层依赖注入越权检查 ──

echo "── Data 层依赖注入检查 ──"
echo ""

# D-1) data 层注入的依赖中包含 UI 操作
count=$(grep -rn "showToastr\|refreshMergedData\|_notifyTableUpdate\|deleteAllGeneratedEntries\|refreshUI\|renderUI" src/data/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok' | wc -l | tr -d ' ')
total=$((total + count))
if [ "$count" -gt 0 ]; then
  echo -e "${RED}[FAIL] data 层注入/调用 UI 相关依赖: $count 处${NC}"
  grep -rn "showToastr\|refreshMergedData\|_notifyTableUpdate\|deleteAllGeneratedEntries\|refreshUI\|renderUI" src/data/ --include='*.ts' 2>/dev/null | grep -v '// arch-ok'
else
  echo -e "${GREEN}[PASS] data 层注入/调用 UI 相关依赖: 0 处${NC}"
fi

echo ""

# ── 汇总 ──

echo "═══════════════════════════════════════════════════"
echo -e "  总计违规: ${total} 条"
echo "═══════════════════════════════════════════════════"

if [ "$total" -gt 0 ]; then
  echo ""
  echo -e "${RED}存在架构违规，构建失败。${NC}"
  echo "提示：如果某处确实是合理的例外，在该行末尾加 // arch-ok 注释可豁免。"
  echo "但每一个 // arch-ok 都必须有充分理由，不能用来批量豁免偷懒行为。"
  exit 1
else
  echo ""
  echo -e "${GREEN}全部通过！${NC}"
  exit 0
fi
