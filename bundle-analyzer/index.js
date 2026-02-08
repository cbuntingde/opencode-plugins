import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SIZE_THRESHOLDS = {
  warning: 500 * 1024,
  critical: 1 * 1024 * 1024,
  maxBundle: 2 * 1024 * 1024
};

function findBuildOutput(dirPath) {
  const buildPatterns = [
    'dist',
    'build',
    'out',
    '.next',
    'public',
    'static'
  ];
  
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        if (buildPatterns.includes(entry.name)) {
          found.push({ name: entry.name, path: fullPath, type: 'directory' });
        } else if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          found.push(...findBuildOutput(fullPath));
        }
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || 
            entry.name.endsWith('.css') || entry.name.endsWith('.min.js') ||
            entry.name.endsWith('.chunk.js') || entry.name.endsWith('.bundle.js')) {
          found.push({ name: entry.name, path: fullPath, type: 'file' });
        }
      }
    }
  } catch (error) {}
  
  return found;
}

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function scanBundleDirectory(dirPath) {
  const files = [];
  const directories = [];
  let totalSize = 0;
  let fileCount = 0;
  
  try {
    function traverse(currentPath) {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              const dirResult = traverse(fullPath);
              directories.push({
                name: entry.name,
                path: fullPath,
                size: dirResult.size,
                files: dirResult.fileCount,
                subdirectories: dirResult.subdirectories.length
              });
              totalSize += dirResult.size;
              fileCount += dirResult.fileCount;
            }
          } else if (entry.isFile()) {
            const size = getFileSize(fullPath);
            files.push({
              name: entry.name,
              path: fullPath,
              size,
              sizeFormatted: formatBytes(size),
              isLarge: size > SIZE_THRESHOLDS.warning,
              isCritical: size > SIZE_THRESHOLDS.critical
            });
            totalSize += size;
            fileCount++;
          }
        }
      } catch (error) {}
    }
    
    traverse(dirPath);
  } catch (error) {}
  
  return { files, directories, size: totalSize, fileCount };
}

function detectLargeDependencies(files) {
  const largeDeps = [];
  const depPatterns = [
    { name: 'moment', patterns: ['moment.js', 'moment.min.js', 'moment-locales'] },
    { name: 'lodash', patterns: ['lodash.js', 'lodash.min.js', 'lodash-es'] },
    { name: 'ramda', patterns: ['ramda.js', 'ramda.min.js'] },
    { name: 'underscore', patterns: ['underscore.js', 'underscore-min.js'] },
    { name: 'axios', patterns: ['axios'] },
    { name: 'react', patterns: ['react.production', 'react.development'] },
    { name: 'vue', patterns: ['vue.js', 'vue.min.js'] },
    { name: 'chart.js', patterns: ['chart.js', 'Chart.js'] },
    { name: 'three.js', patterns: ['three.js', 'three.min.js'] },
    { name: 'leaflet', patterns: ['leaflet'] },
    { name: 'pdfjs', patterns: ['pdf.js', 'pdf.worker.js'] }
  ];
  
  depPatterns.forEach(dep => {
    const foundFiles = files.filter(f => 
      dep.patterns.some(p => f.name.toLowerCase().includes(p.toLowerCase()))
    );
    
    if (foundFiles.length > 0) {
      const totalSize = foundFiles.reduce((sum, f) => sum + f.size, 0);
      largeDeps.push({
        dependency: dep.name,
        files: foundFiles.map(f => f.name),
        totalSize,
        sizeFormatted: formatBytes(totalSize),
        alternatives: getAlternatives(dep.name)
      });
    }
  });
  
  return largeDeps;
}

function getAlternatives(depName) {
  const alternatives = {
    moment: ['date-fns (modular)', 'dayjs (1KB)', 'luxon'],
    lodash: ['lodash-es (tree-shakeable)', 'native ES6'],
    ramda: ['native functional utilities'],
    underscore: ['native ES6', 'lodash-es'],
    axios: ['native fetch', 'ky'],
    'chart.js': ['chartist', 'visx', 'nivo'],
    'three.js': ['babylon.js', 'regl'],
    'pdf.js': ['pdf-lib', 'react-pdf']
  };
  
  return alternatives[depName] || [];
}

function checkTreeShaking(files, packageJsonPath) {
  const issues = [];
  
  try {
    const pkgContent = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    
    const esModules = [];
    
    if (pkg.dependencies) {
      Object.keys(pkg.dependencies).forEach(dep => {
        if (dep.includes('-')) {
          esModules.push(dep);
        }
      });
    }
    
    const nonTreeShakeable = files.filter(f => 
      f.name.includes('.min.js') || 
      f.name.includes('.bundle.js') ||
      (f.name.endsWith('.js') && f.size > 500 * 1024)
    );
    
    if (nonTreeShakeable.length > 10) {
      issues.push({
        type: 'tree-shaking',
        severity: 'medium',
        message: `Many large bundled files - consider tree-shaking`,
        count: nonTreeShakeable.length
      });
    }
    
  } catch (error) {}
  
  return issues;
}

function detectDuplicates(files) {
  const fileNames = {};
  const duplicates = [];
  
  files.forEach(file => {
    const baseName = path.basename(file.name, '.js');
    
    if (!fileNames[baseName]) {
      fileNames[baseName] = [];
    }
    fileNames[baseName].push(file);
  });
  
  Object.entries(fileNames).forEach(([name, fileList]) => {
    if (fileList.length > 1) {
      duplicates.push({
        name,
        files: fileList.map(f => ({ path: f.path, size: f.size })),
        totalSize: fileList.reduce((sum, f) => sum + f.size, 0)
      });
    }
  });
  
  return duplicates.filter(d => d.totalSize > 100 * 1024);
}

export const BundleAnalyzerPlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      bundle_size: {
        description: 'Check bundle size against thresholds',
        args: {
          path: { type: 'string', description: 'Build output directory' },
          maxSize: { type: 'string', description: 'Maximum bundle size (e.g., 1MB)' }
        },
        async execute({ path: buildPath, maxSize }, { directory: ctxDir }) {
          const dirToScan = buildPath || ctxDir || targetDir;
          const maxBytes = maxSize ? parseSize(maxSize) : SIZE_THRESHOLDS.maxBundle;
          
          const buildDirs = findBuildOutput(dirToScan);
          
          if (buildDirs.length === 0) {
            return {
              passed: false,
              error: 'No build output found',
              recommendation: 'Build the project first (npm run build)',
              searchedPath: dirToScan
            };
          }
          
          const mainBuildDir = buildDirs.find(d => d.name === 'dist' || d.name === 'build') || buildDirs[0];
          
          const { files, size, fileCount } = scanBundleDirectory(mainBuildDir.path);
          
          const largeFiles = files.filter(f => f.size > SIZE_THRESHOLDS.warning);
          const criticalFiles = files.filter(f => f.size > SIZE_THRESHOLDS.critical);
          
          const largeDeps = detectLargeDependencies(files);
          const duplicates = detectDuplicates(files);
          
          const passed = size <= maxBytes && criticalFiles.length === 0;
          
          return {
            passed,
            summary: {
              totalSize: size,
              sizeFormatted: formatBytes(size),
              maxSize: maxBytes,
              sizeFormattedMax: formatBytes(maxBytes),
              fileCount,
              largeFiles: largeFiles.length,
              criticalFiles: criticalFiles.length
            },
            status: size < SIZE_THRESHOLDS.warning ? 'good' : 
                     size < SIZE_THRESHOLDS.critical ? 'warning' : 'critical',
            largeFiles: largeFiles.slice(0, 20),
            criticalFiles,
            largeDependencies: largeDeps,
            duplicates: duplicates.slice(0, 10),
            recommendation: criticalFiles.length > 0 
              ? `Bundle is ${formatBytes(size)} - exceeds ${formatBytes(SIZE_THRESHOLDS.critical)} critical threshold`
              : largeFiles.length > 0 
                ? `Consider splitting large chunks: ${largeFiles[0]?.name || 'first chunk'}`
                : 'Bundle size is acceptable'
          };
        }
      },
      
      bundle_report: {
        description: 'Generate detailed bundle analysis report',
        args: {
          path: { type: 'string', description: 'Build output path' }
        },
        async execute({ path: buildPath }, { directory: ctxDir }) {
          const dirToScan = buildPath || ctxDir || targetDir;
          const buildDirs = findBuildOutput(dirToScan);
          
          if (buildDirs.length === 0) {
            return { error: 'No build output found', recommendation: 'Build the project first' };
          }
          
          const mainBuildDir = buildDirs.find(d => d.name === 'dist' || d.name === 'build') || buildDirs[0];
          
          const { files, directories, size, fileCount } = scanBundleDirectory(mainBuildDir.path);
          
          const largeDeps = detectLargeDependencies(files);
          const duplicates = detectDuplicates(files);
          
          const byType = {
            javascript: files.filter(f => f.name.endsWith('.js') || f.name.endsWith('.mjs')),
            css: files.filter(f => f.name.endsWith('.css')),
            other: files.filter(f => !f.name.endsWith('.js') && !f.name.endsWith('.css'))
          };
          
          const jsSize = byType.javascript.reduce((sum, f) => sum + f.size, 0);
          const cssSize = byType.css.reduce((sum, f) => sum + f.size, 0);
          
          const sortedFiles = [...files].sort((a, b) => b.size - a.size);
          const sortedDirs = [...directories].sort((a, b) => b.size - a.size);
          
          return {
            summary: {
              totalSize: size,
              sizeFormatted: formatBytes(size),
              fileCount,
              jsSize: jsSize,
              cssSize: cssSize
            },
            largestFiles: sortedFiles.slice(0, 20),
            largestDirectories: sortedDirs.slice(0, 10),
            byType: {
              javascript: { count: byType.javascript.length, size: jsSize, percentage: Math.round((jsSize/size)*100) },
              css: { count: byType.css.length, size: cssSize, percentage: Math.round((cssSize/size)*100) },
              other: { count: byType.other.length, size: size - jsSize - cssSize }
            },
            largeDependencies: largeDeps,
            duplicates,
            recommendations: [
              ...largeDeps.map(d => `Consider replacing ${d.dependency} (${d.sizeFormatted}) with lighter alternative`),
              ...duplicates.map(d => `Remove duplicate: ${d.name} appears ${d.files.length} times (${formatBytes(d.totalSize)})`),
              ...sortedFiles.slice(0, 3).map(f => `Split or lazy load ${f.name} (${f.sizeFormatted})`)
            ]
          };
        }
      },
      
      bundle_optimize: {
        description: 'Check for bundle optimization opportunities',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const packageJsonPath = path.join(dirToScan, 'package.json');
          
          const issues = [];
          const suggestions = [];
          
          try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            
            const deps = pkg.dependencies || {};
            const devDeps = pkg.devDependencies || {};
            
            Object.keys(deps).forEach(dep => {
              const largeAlternatives = ['moment', 'lodash', 'ramda', 'underscore', 'axios'];
              
              if (largeAlternatives.some(a => dep.includes(a))) {
                suggestions.push({
                  dependency: dep,
                  currentVersion: deps[dep],
                  suggestion: `Consider ${getAlternatives(dep.split('/').pop())[0] || 'modular alternative'}`,
                  impact: 'High'
                });
              }
            });
            
            const buildConfig = pkg.scripts || {};
            if (!buildConfig.build?.includes('webpack') && !buildConfig.build?.includes('vite') && 
                !buildConfig.build?.includes('rollup') && !buildConfig.build?.includes('esbuild')) {
              issues.push({
                type: 'build-tool',
                severity: 'info',
                message: 'No modern bundler detected - consider using vite, esbuild, or rollup for better optimization'
              });
            }
            
            const hasBabel = devDeps['@babel/core'] || devDeps['babel-loader'];
            const hasSWC = devDeps['@swc/core'];
            
            if (hasBabel && !hasSWC) {
              suggestions.push({
                dependency: 'Babel',
                suggestion: 'Consider replacing Babel with SWC for faster builds',
                impact: 'Medium'
              });
            }
            
          } catch (error) {
            issues.push({ type: 'error', severity: 'low', message: 'Could not read package.json' });
          }
          
          const buildDirs = findBuildOutput(dirToScan);
          const mainBuildDir = buildDirs.find(d => d.name === 'dist' || d.name === 'build');
          
          if (mainBuildDir) {
            const { files } = scanBundleDirectory(mainBuildDir.path);
            const duplicates = detectDuplicates(files);
            
            duplicates.forEach(d => {
              issues.push({
                type: 'duplicate',
                severity: 'high',
                message: `Duplicate file: ${d.name}`,
                files: d.files.map(f => path.basename(f.path))
              });
            });
          }
          
          return {
            passed: issues.filter(i => i.severity === 'high').length === 0,
            issues,
            suggestions,
            summary: {
              issuesCount: issues.length,
              suggestionsCount: suggestions.length
            },
            recommendation: suggestions.length > 0 
              ? `${suggestions.length} optimization opportunities found`
              : 'No obvious optimization opportunities'
          };
        }
      }
    }
  };
};

function parseSize(sizeStr) {
  const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  
  if (match) {
    return parseFloat(match[1]) * multipliers[match[2].toUpperCase()];
  }
  
  return SIZE_THRESHOLDS.maxBundle;
}