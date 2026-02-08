import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_SECTIONS = [
  { name: 'Installation', keywords: ['install', 'setup', 'npm', 'pip install', 'go get', 'cargo add'] },
  { name: 'Usage', keywords: ['usage', 'example', 'how to use', 'quick start', 'getting started'] },
  { name: 'Configuration', keywords: ['config', 'environment', 'env', 'settings', 'options'] },
  { name: 'API Documentation', keywords: ['api', 'endpoints', 'routes', 'methods', 'request', 'response'] },
  { name: 'Testing', keywords: ['test', 'run tests', 'npm test', 'jest', 'pytest', 'mocha'] },
  { name: 'License', keywords: ['license', 'mit', 'apache', 'gnu', 'bsd'] },
  { name: 'Contributing', keywords: ['contributing', 'contribute', 'pull request', 'pr', 'guidelines'] },
  { name: 'Prerequisites', keywords: ['prerequisite', 'require', 'needed', 'dependencies'] },
  { name: 'Architecture', keywords: ['architecture', 'structure', 'diagram', 'design', 'overview'] },
  { name: 'Security', keywords: ['security', 'authentication', 'authorization', 'secure'] }
];

function findReadmeFiles(dirPath) {
  const readmeNames = ['README.md', 'readme.md', 'Readme.md', 'README.MD'];
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile()) {
        if (readmeNames.includes(entry.name)) {
          found.push(fullPath);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        found.push(...findReadmeFiles(fullPath));
      }
    }
  } catch (error) {}
  
  return found;
}

function parseMarkdown(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return {
      content,
      sections: parseSections(content),
      links: extractLinks(content),
      codeBlocks: extractCodeBlocks(content),
      headers: extractHeaders(content)
    };
  } catch (error) {
    return { content: '', sections: [], links: [], codeBlocks: [], headers: [] };
  }
}

function parseSections(content) {
  const sections = [];
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    if (line.startsWith('#')) {
      const level = line.match(/^#+/)[0].length;
      const title = line.replace(/^#+\s*/, '').trim();
      sections.push({ level, title, line: index + 1, content: '' });
    }
  });
  
  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].line;
    const end = i < sections.length - 1 ? sections[i + 1].line : lines.length;
    sections[i].content = lines.slice(start, end).join('\n');
  }
  
  return sections;
}

function extractLinks(content) {
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let match;
  
  while ((match = linkPattern.exec(content)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }
  
  return links;
}

function extractCodeBlocks(content) {
  const pattern = /```(\w*)\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  
  while ((match = pattern.exec(content)) !== null) {
    blocks.push({ language: match[1], code: match[2] });
  }
  
  return blocks;
}

function extractHeaders(content) {
  const pattern = /^#+\s+(.+)$/gm;
  const headers = [];
  let match;
  
  while ((match = pattern.exec(content)) !== null) {
    headers.push(match[1].trim());
  }
  
  return headers;
}

function checkSectionPresence(parsed, sectionName, keywords) {
  const found = {
    name: sectionName,
    found: false,
    headers: [],
    keywordMatches: 0
  };
  
  parsed.headers.forEach(header => {
    const lowerHeader = header.toLowerCase();
    
    if (lowerHeader.includes(sectionName.toLowerCase())) {
      found.found = true;
      found.headers.push(header);
    }
    
    keywords.forEach(keyword => {
      if (lowerHeader.includes(keyword.toLowerCase()) || 
          parsed.content.toLowerCase().includes(keyword.toLowerCase())) {
        found.keywordMatches++;
      }
    });
  });
  
  return found;
}

function validateCodeExamples(parsed) {
  const issues = [];
  
  if (parsed.codeBlocks.length === 0) {
    issues.push({ type: 'warning', message: 'No code examples found in README' });
    return issues;
  }
  
  parsed.codeBlocks.forEach((block, index) => {
    if (!block.language && block.code.length > 50) {
      issues.push({ 
        type: 'suggestion', 
        message: `Code block ${index + 1} has no language specified`,
        line: index + 1
      });
    }
    
    if (block.code.includes('TODO') || block.code.includes('FIXME')) {
      issues.push({
        type: 'warning',
        message: `Code block ${index + 1} contains TODO/FIXME`,
        line: index + 1
      });
    }
  });
  
  return issues;
}

function validateLinks(links) {
  const issues = [];
  const externalLinks = links.filter(l => l.url.startsWith('http'));
  const brokenPatterns = [
    /\[\^?\d+\]/,
    /\[source\](?!\()/i,
    /\[ref\](?!\()/i
  ];
  
  links.forEach((link, index) => {
    if (!link.url || !link.text) {
      issues.push({ type: 'error', message: `Link ${index + 1} is missing text or URL` });
    }
    
    brokenPatterns.forEach(pattern => {
      if (pattern.test(link.text)) {
        issues.push({ type: 'warning', message: `Link ${index + 1} may be a reference placeholder` });
      }
    });
  });
  
  return { total: links.length, external: externalLinks.length, issues };
}

export const ReadmeValidatorPlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      readme_validate: {
        description: 'Validate README documentation completeness',
        args: {
          path: { type: 'string', description: 'Path to project directory' },
          strict: { type: 'boolean', description: 'Enable strict validation (default: false)' }
        },
        async execute({ path: projectPath, strict = false }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const readmeFiles = findReadmeFiles(dirToScan);
          
          if (readmeFiles.length === 0) {
            return {
              passed: false,
              error: 'No README file found',
              recommendation: 'Create a README.md file in the project root',
              searchedPath: dirToScan
            };
          }
          
          const mainReadme = readmeFiles[0];
          const parsed = parseMarkdown(mainReadme);
          
          const sectionsCheck = REQUIRED_SECTIONS.map(req => {
            const check = checkSectionPresence(parsed, req.name, req.keywords);
            return { ...check, required: strict };
          });
          
          const found = sectionsCheck.filter(s => s.found);
          const missing = sectionsCheck.filter(s => !s.found);
          
          const codeIssues = validateCodeExamples(parsed);
          const linksCheck = validateLinks(parsed.links);
          
          const wordCount = parsed.content.split(/\s+/).length;
          const hasBadges = parsed.content.includes('[![') || parsed.content.includes('![Build');
          const hasScreenshots = parsed.content.includes('![Screenshot') || parsed.content.includes('![Demo');
          
          let passed = strict 
            ? missing.length === 0 
            : missing.length <= 2 && parsed.codeBlocks.length > 0;
          
          return {
            passed,
            file: mainReadme,
            wordCount,
            sections: {
              found: found.map(s => s.name),
              missing: missing.map(s => s.name),
              details: sectionsCheck
            },
            badges: hasBadges,
            screenshots: hasScreenshots,
            codeExamples: parsed.codeBlocks.length,
            links: linksCheck,
            issues: codeIssues,
            score: Math.round((found.length / sectionsCheck.length) * 100),
            recommendation: missing.length > 0 
              ? `Add missing sections: ${missing.map(s => s.name).join(', ')}`
              : parsed.codeBlocks.length === 0 
                ? 'Add code examples to demonstrate usage'
                : 'README meets requirements'
          };
        }
      },
      
      readme_sections: {
        description: 'List missing README sections',
        args: {
          path: { type: 'string', description: 'Path to project' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const readmeFiles = findReadmeFiles(dirToScan);
          
          if (readmeFiles.length === 0) {
            return {
              passed: false,
              missing: REQUIRED_SECTIONS.map(s => s.name),
              recommendation: 'Create a README.md file first'
            };
          }
          
          const parsed = parseMarkdown(readmeFiles[0]);
          
          const found = [];
          const missing = [];
          
          REQUIRED_SECTIONS.forEach(req => {
            const foundInSection = parsed.headers.some(h => 
              h.toLowerCase().includes(req.name.toLowerCase())
            );
            
            if (foundInSection) {
              found.push(req.name);
            } else {
              missing.push(req.name);
            }
          });
          
          return {
            passed: missing.length === 0,
            found,
            missing,
            totalRequired: REQUIRED_SECTIONS.length,
            recommendation: missing.length > 0 
              ? `Add these sections: ${missing.join(', ')}`
              : 'All recommended sections present'
          };
        }
      },
      
      readme_checklist: {
        description: 'Generate a README checklist for the project',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const readmeFiles = findReadmeFiles(dirToScan);
          
          const checklist = REQUIRED_SECTIONS.map(req => ({
            section: req.name,
            present: false,
            suggestion: `Add a "${req.name}" section`
          }));
          
          if (readmeFiles.length > 0) {
            const parsed = parseMarkdown(readmeFiles[0]);
            
            checklist.forEach(item => {
              item.present = parsed.headers.some(h => 
                h.toLowerCase().includes(item.section.toLowerCase())
              );
            });
          }
          
          const present = checklist.filter(i => i.present).length;
          
          return {
            checklist,
            progress: `${present}/${checklist.length} sections present`,
            percentage: Math.round((present / checklist.length) * 100),
            recommendations: checklist
              .filter(i => !i.present)
              .map(i => i.suggestion)
          };
        }
      }
    }
  };
};