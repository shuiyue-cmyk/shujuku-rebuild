#!/usr/bin/env bash
# scripts/publish-extension.sh — 一键构建插件并推送到 release 制品分支
#
# 用法：
#   npm run publish:extension          # 使用 manifest.json 中的版本号
#   npm run publish:extension -- 1.2.0 # 指定版本号
#
# 流程：
#   1. 校验依赖、分支和产物路径
#   2. 如有工作区改动则统一 stash（包含 untracked）
#   3. 构建 extension 产物
#   4. 将产物复制到临时目录
#   5. 切换到 release 分支并覆盖 index.js / manifest.json
#   6. 仅在实际有差异时提交并推送
#   7. 切回原分支并恢复 stash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_BRANCH="release"
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t acu-extension-publish)"
MANIFEST="$PROJECT_ROOT/manifest.json"
DIST_DIR="$PROJECT_ROOT/dist/extension"
ORIGINAL_HEAD=""
CURRENT_BRANCH=""
STASH_CREATED=false
RESTORE_BRANCH=true

cd "$PROJECT_ROOT"

require_command() {
    local cmd="$1"
    command -v "$cmd" >/dev/null 2>&1 || fail "缺少命令：$cmd"
}

cleanup() {
    local exit_code=$?

    rm -rf "$TMP_DIR" 2>/dev/null || true

    if [ "$RESTORE_BRANCH" = true ] && [ -n "$CURRENT_BRANCH" ]; then
        local head_branch
        head_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
        if [ "$head_branch" != "$CURRENT_BRANCH" ]; then
            warn "清理阶段切回 $CURRENT_BRANCH..."
            git checkout "$CURRENT_BRANCH" >/dev/null 2>&1 || true
        fi
    fi

    if [ "$STASH_CREATED" = true ]; then
        warn "恢复 stash..."
        git stash pop >/dev/null 2>&1 || warn "stash pop 失败，请手动执行 git stash list / git stash pop"
        STASH_CREATED=false
    fi

    if [ $exit_code -ne 0 ]; then
        fail "发布失败！已尽力恢复到原始状态。"
    fi
}
trap cleanup EXIT

info "Step 1/6: 检查环境..."
require_command git
require_command node
require_command npx

[ -f "$MANIFEST" ] || fail "manifest.json 不存在：$MANIFEST"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
ORIGINAL_HEAD="$(git rev-parse HEAD)"

if [ "$CURRENT_BRANCH" = "$RELEASE_BRANCH" ]; then
    fail "当前已经位于 release 分支，禁止在产物分支上执行发布脚本。"
fi

if ! git show-ref --verify --quiet "refs/heads/$RELEASE_BRANCH"; then
    fail "本地 release 分支不存在，请先执行：git fetch origin ${RELEASE_BRANCH}:${RELEASE_BRANCH}"
fi

if [ -n "${1:-}" ]; then
    VERSION="$1"
    info "使用指定版本号: $VERSION"
else
    VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version)" "$MANIFEST")"
    info "从 manifest.json 读取版本号: $VERSION"
fi

ok "环境检查通过"

info "Step 2/6: 保存工作区状态..."
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
    git stash push --include-untracked -m "publish-extension: auto stash before release" >/dev/null
    STASH_CREATED=true
    ok "已 stash 当前工作区改动"
else
    ok "工作区干净，无需 stash"
fi

info "Step 3/6: 构建插件..."
BUILD_MODE=extension npx rollup -c

[ -f "$DIST_DIR/index.js" ] || fail "构建失败：缺少 $DIST_DIR/index.js"
[ -f "$DIST_DIR/manifest.json" ] || fail "构建失败：缺少 $DIST_DIR/manifest.json"
[ -f "$DIST_DIR/sql-wasm.wasm" ] || fail "构建失败：缺少 $DIST_DIR/sql-wasm.wasm（wasm 引擎产物）"

INDEX_SIZE=$(wc -c < "$DIST_DIR/index.js" | tr -d ' ')
WASM_SIZE=$(wc -c < "$DIST_DIR/sql-wasm.wasm" | tr -d ' ')
ok "构建完成: index.js (${INDEX_SIZE} bytes)"
ok "构建完成: sql-wasm.wasm (${WASM_SIZE} bytes)"

info "Step 4/6: 备份产物到临时目录..."
cp "$DIST_DIR/index.js" "$TMP_DIR/index.js"
cp "$DIST_DIR/manifest.json" "$TMP_DIR/manifest.json"
cp "$DIST_DIR/sql-wasm.wasm" "$TMP_DIR/sql-wasm.wasm"
ok "产物已备份到 $TMP_DIR"

info "Step 5/6: 更新 release 分支产物..."
git checkout "$RELEASE_BRANCH" >/dev/null
ok "已切换到 $RELEASE_BRANCH 分支"

cp "$TMP_DIR/index.js" "$PROJECT_ROOT/index.js"
cp "$TMP_DIR/manifest.json" "$PROJECT_ROOT/manifest.json"
cp "$TMP_DIR/sql-wasm.wasm" "$PROJECT_ROOT/sql-wasm.wasm"

git add index.js manifest.json sql-wasm.wasm

if git diff --cached --quiet -- index.js manifest.json sql-wasm.wasm; then
    warn "产物内容无变化，跳过提交。"
else
    git commit \
        -m "release: v${VERSION}" \
        -m "构建时间: $(date '+%Y-%m-%d %H:%M:%S')" \
        -m "来源分支: ${CURRENT_BRANCH}" \
        -m "来源提交: ${ORIGINAL_HEAD}"
    ok "已提交: release v${VERSION}"
fi

info "Step 6/6: 推送并恢复现场..."
git push origin "$RELEASE_BRANCH"
ok "已推送到 origin/$RELEASE_BRANCH"

git checkout "$CURRENT_BRANCH" >/dev/null
ok "已切回 $CURRENT_BRANCH"
RESTORE_BRANCH=false

if [ "$STASH_CREATED" = true ]; then
    git stash pop >/dev/null 2>&1 || warn "stash pop 失败，请手动执行 git stash list / git stash pop"
    STASH_CREATED=false
    ok "已恢复 stash"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ 发布成功！v${VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "  安装方式："
echo "    URL:    https://github.com/AlbusKen/shujuku"
echo "    Branch: release"
echo ""
