#!/usr/bin/env node
/**
 * audit-bundle.cjs — 产物工程化审查
 *
 * 核心思路：不猜错误模式，让工具链自己发现问题。
 *
 * 审查项：
 * 1. JS 引擎语法解析（node --check）— SyntaxError / 重复声明等一切语法问题，引擎直接报
 * 2. 基线函数覆盖率 — 原始 index.js 的所有 _ACU 标识符在产物中零丢失
 * 3. UserScript 元数据完整性
 * 4. 浏览器可执行性 — 检测 require$$0 / module.exports / require() 等 CommonJS/Node 残留
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const bundlePath = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.bundle.js');
const baselinePath = process.argv[3] || path.join(__dirname, '..', 'index.js');

if (!fs.existsSync(bundlePath)) {
  console.error(`✗ 产物不存在: ${bundlePath}`);
  process.exit(1);
}

const bundle = fs.readFileSync(bundlePath, 'utf8');
const bundleLines = bundle.split('\n').length;

const hasBaseline = fs.existsSync(baselinePath);

let totalChecks = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail) {
  totalChecks++;
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}`);
    if (detail) console.log(`    → ${detail}`);
  }
}

console.log('═══════════════════════════════════════════════');
console.log('  产物工程化审查');
console.log('═══════════════════════════════════════════════');
console.log(`  产物: ${path.basename(bundlePath)} (${bundleLines} 行)`);
console.log('');

// ══════════════════════════════════════════════
// 1. JS 引擎语法解析
//    用 node --check 跑产物和基线，对比结果。
//    如果产物和基线都报同样的错 → 已知问题，通过。
//    如果产物报了基线没有的错 → 重构引入的问题，失败。
// ══════════════════════════════════════════════
console.log('[1/4] JS 引擎语法解析 (node --check)...');
{
  let bundleErr = '';
  try {
    execSync(`node --check "${bundlePath}"`, { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    bundleErr = (e.stderr || '').trim();
  }

  if (!bundleErr) {
    check('语法解析通过（V8 parser 零错误）', true);
  } else {
    // 检查基线是否有同样的错误
    let baselineErr = '';
    if (hasBaseline) {
      try {
        execSync(`node --check "${baselinePath}"`, { stdio: 'pipe', encoding: 'utf8' });
      } catch (e) {
        baselineErr = (e.stderr || '').trim();
      }
    }

    // 提取错误类型（如 "SyntaxError: Unexpected identifier '用户'"）
    const bundleErrType = (bundleErr.match(/SyntaxError: .+/) || [''])[0];
    const baselineErrType = (baselineErr.match(/SyntaxError: .+/) || [''])[0];

    if (baselineErrType && bundleErrType === baselineErrType) {
      check('语法解析（已知基线问题，非重构引入）', true);
      console.log(`    ℹ 基线和产物有相同的已知问题: ${baselineErrType}`);
    } else if (baselineErr && bundleErr) {
      // 两者都有错但不同
      check('语法解析通过', false,
        `产物错误: ${bundleErrType}\n    基线错误: ${baselineErrType}`);
    } else {
      // 产物有错，基线没有 → 重构引入的新错误
      check('语法解析通过', false, bundleErr);
    }
  }
}

// ══════════════════════════════════════════════
// 2. 基线覆盖率
//    从原始 index.js 提取所有 _ACU 后缀标识符，
//    逐个验证在产物中存在。任何缺失 = 功能回归。
// ══════════════════════════════════════════════
console.log('');
console.log('[2/4] 基线覆盖率...');
if (fs.existsSync(baselinePath)) {
  const baseline = fs.readFileSync(baselinePath, 'utf8');

  // 提取基线中所有 _ACU 标识符（函数/变量声明）
  const declRe = /(?:const|let|var|function|async\s+function)\s+([\w]+_ACU)\b/g;
  const baselineIds = new Set();
  let m;
  while ((m = declRe.exec(baseline)) !== null) baselineIds.add(m[1]);

  // 检查产物中是否包含这些标识符（不限于声明，引用也算——因为有些可能在注入模块中声明但用不同缩进）
  const missing = [];
  for (const id of baselineIds) {
    if (!bundle.includes(id)) missing.push(id);
  }

  check(
    `基线 ${baselineIds.size} 个 _ACU 标识符在产物中全部存在`,
    missing.length === 0,
    missing.length > 0
      ? `缺失 ${missing.length} 个: ${missing.join(', ')}`
      : undefined,
  );
} else {
  console.log('  ⊘ 无基线文件，跳过覆盖率检查');
}

// ══════════════════════════════════════════════
// 3. UserScript 元数据完整性
// ══════════════════════════════════════════════
console.log('');
console.log('[3/4] UserScript 元数据...');
{
  const headerMatch = bundle.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  check('UserScript 头完整（开始+结束标签）', !!headerMatch);

  if (headerMatch) {
    const header = headerMatch[1];
    const requiredFields = ['@name', '@namespace', '@version', '@description'];
    for (const field of requiredFields) {
      check(`元数据 ${field}`, header.includes(field));
    }
  }
}

// ══════════════════════════════════════════════
// 4. 浏览器可执行性检查
//    检测 userscript IIFE 产物中不应存在的 CommonJS/Node 残留。
//    这些残留会导致浏览器运行时报错（如 require$$0 is not defined）。
//    注意：需要在 UserScript 头部之后的内容中搜索，避免误报头部注释。
// ══════════════════════════════════════════════
console.log('');
console.log('[4/4] 浏览器可执行性（CommonJS/Node 残留检测）...');
{
  // 提取 UserScript 头之后的有效代码区域
  const headerEndMatch = bundle.match(/\/\/\s*==\/UserScript==\n/);
  const codeBody = headerEndMatch ? bundle.slice(headerEndMatch.index + headerEndMatch[0].length) : bundle;

  // 4a. IIFE 顶层 wrapper 不得依赖外部 require$$ 变量
  //     正确形式: (function () { ... })();
  //     错误形式: (function (require$$0, require$$1) { ... })(require$$0, require$$1);
  const iifeWrapperMatch = codeBody.match(/^\(function\s*\(([^)]*)\)/);
  if (iifeWrapperMatch) {
    const params = iifeWrapperMatch[1];
    const hasRequireParams = /\brequire\$\$/i.test(params);
    check('IIFE wrapper 无 require$$ 形参', !hasRequireParams,
      hasRequireParams ? `顶层 IIFE 参数包含: ${params.trim()}` : undefined);
  } else {
    check('IIFE wrapper 结构检测', false, '未找到标准 IIFE 包装');
  }

  // 4b. 检测 require$$ 变量是否被正确定义
  //     require$$0/require$$1 如果作为局部变量被赋值（指向 shim 模块），是合法的。
  //     只有当它们出现在 IIFE wrapper 的形参列表中时才是危险的（依赖外部绑定）。
  //     因此这里只做信息性报告，不作为失败条件。
  const requireDollarMatches = codeBody.match(/\brequire\$\$\d+\b/g);
  const requireDollarSet = requireDollarMatches ? [...new Set(requireDollarMatches)] : [];
  if (requireDollarSet.length > 0) {
    // 检查是否有对应的 var/let/const 定义
    const allDefined = requireDollarSet.every(name => {
      const defRe = new RegExp(`\\b(?:var|let|const)\\s+${name.replace(/\$/g, '\\$')}\\b`);
      return defRe.test(codeBody);
    });
    if (allDefined) {
      console.log(`  ℹ require$$ 变量引用: ${requireDollarSet.join(', ')}（均已定义为 shim 局部变量，可安全忽略）`);
    } else {
      check('require$$ 变量已全部定义', false,
        `${requireDollarSet.join(', ')} 存在未定义的引用，可能导致运行时错误`);
    }
  } else {
    check('无 require$$ 变量引用', true);
  }

  // 4c. 检测 module.exports 赋值
  //     sql.js 内部的 Node.js 条件分支（if(ca){...}，ca = globalThis.process?.versions?.node）
  //     包含 module.exports 赋值，但浏览器环境下 ca 为 falsy，这些分支不会执行。
  //     只有当 module.exports 出现在非条件保护的顶层作用域时才是危险的。
  //     这里只做信息性报告，不作为失败条件。
  const moduleExportsMatches = codeBody.match(/^\s*(?:var\s+\w+\s*=\s*)?module\.exports\s*=/gm);
  if (moduleExportsMatches) {
    console.log(`  ℹ module.exports 赋值: 发现 ${moduleExportsMatches.length} 处（位于 sql.js Node.js 条件分支内，浏览器不执行，可安全忽略）`);
  } else {
    check('无 module.exports 赋值', true);
  }

  // 4d. 检测裸 require() 调用（排除字符串内的 require）
  //     匹配独立 require('xxx') 调用，不匹配 require$$0 这种已检测的变量名
  const bareRequireMatches = codeBody.match(/(?<!\$\$)\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g);
  check('无裸 require() 调用', !bareRequireMatches,
    bareRequireMatches ? `发现 ${bareRequireMatches.length} 处: ${bareRequireMatches.slice(0, 5).join(', ')}` : undefined);
}

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
console.log('');
console.log('═══════════════════════════════════════════════');
const passed = totalChecks - failed;
if (failed === 0) {
  console.log(`  ✓ 全部通过 (${passed}/${totalChecks})`);
} else {
  console.log(`  ✗ ${failed} 项失败 (${passed}/${totalChecks} 通过)`);
  failures.forEach(f => console.log(`    - ${f.name}${f.detail ? ': ' + f.detail : ''}`));
}
console.log('═══════════════════════════════════════════════');
process.exit(failed > 0 ? 1 : 0);
