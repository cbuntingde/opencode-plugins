import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const DOC_SECTIONS = [
  { name: 'Authentication', patterns: ['auth', 'authentication', 'jwt', 'bearer', 'api-key', 'apikey'] },
  { name: 'Endpoints', patterns: ['endpoint', 'route', 'api', '/api'] },
  { name: 'Request Format', patterns: ['request', 'body', 'payload', 'json'] },
  { name: 'Response Format', patterns: ['response', 'status', 'code'] },
  { name: 'Error Handling', patterns: ['error', 'exception', 'handling'] },
  { name: 'Rate Limiting', patterns: ['rate', 'limit', 'throttle'] },
  { name: 'Examples', patterns: ['example', 'curl', 'usage'] }
];

function findApiDocFiles(dirPath) {
  const docNames = ['API.md', 'api.md', 'API.mdx', 'api.mdx', 'ENDPOINTS.md', 'endpoints.md', 
                    'OPENAPI.md', 'openapi.md', 'SWAGGER.md', 'swagger.md', 'API.md'];
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile()) {
        if (docNames.includes(entry.name) || entry.name.toLowerCase().includes('api') && entry.name.endsWith('.md')) {
          found.push(fullPath);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        found.push(...findApiDocFiles(fullPath));
      }
    }
  } catch (error) {}
  
  return found;
}

function parseMarkdown(content) {
  const headers = [];
  const links = [];
  const codeBlocks = [];
  
  const headerPattern = /^#{1,6}\s+(.+)$/gm;
  let match;
  
  while ((match = headerPattern.exec(content)) !== null) {
    headers.push(match[1].trim());
  }
  
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkPattern.exec(content)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }
  
  const codePattern = /```(\w*)\n([\s\S]*?)```/g;
  while ((match = codePattern.exec(content)) !== null) {
    codeBlocks.push({ language: match[1], code: match[2] });
  }
  
  return { headers, links, codeBlocks };
}

function extractEndpoints(content) {
  const endpoints = [];
  
  const patterns = [
    { method: 'GET', regex: /(?:GET|###)\s+(?:`?(\/[a-zA-Z0-9\/{}:-]+)`?)/g },
    { method: 'POST', regex: /(?:POST|###)\s+(?:`?(\/[a-zA-Z0-9\/{}:-]+)`?)/g },
    { method: 'PUT', regex: /(?:PUT|###)\s+(?:`?(\/[a-zA-Z0-9\/{}:-]+)`?)/g },
    { method: 'PATCH', regex: /(?:PATCH|###)\s+(?:`?(\/[a-zA-Z0-9\/{}:-]+)`?)/g },
    { method: 'DELETE', regex: /(?:DELETE|###)\s+(?:`?(\/[a-zA-Z0-9\/{}:-]+)`?)/g }
  ];
  
  HTTP_METHODS.forEach(method => {
    const upperMethod = method.toUpperCase();
    const regex = new RegExp(`${upperMethod}\\s+\`?(\\/[a-zA-Z0-9\\/\\{\\}:-]+)\`?`, 'g');
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      endpoints.push({
        method: upperMethod,
        path: match[1].replace(/`/g, ''),
        found: true
      });
    }
  });
  
  const headerPatterns = content.match(/^#{1,3}\s+.*(?:Endpoint|Route|API).*$/gmi) || [];
  headerPatterns.forEach(header => {
    if (header.includes('GET')) {
      const paths = header.match(/\/[a-zA-Z0-9\/{}:-]+/g);
      paths?.forEach(p => endpoints.push({ method: 'GET', path: p }));
    }
  });
  
  return endpoints;
}

function validateEndpointDocs(content, endpoints) {
  const issues = [];
  const documentedPaths = new Set();
  const documentedMethods = new Set();
  
  HTTP_METHODS.forEach(method => {
    const methodUpper = method.toUpperCase();
    const patterns = [
      new RegExp(`${methodUpper}\\s+\`?(\\/[a-zA-Z0-9\\/\\{\\}:-]+)\`?`, 'g'),
      new RegExp(`###\\s+${methodUpper}\\s+\`?(\\/[a-zA-Z0-9\\/\\{\\}:-]+)\`?`, 'g')
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        documentedPaths.add(match[1].replace(/`/g, ''));
        documentedMethods.add(methodUpper);
      }
    });
  });
  
  const undocumented = endpoints.filter(e => !documentedPaths.has(e.path));
  
  if (undocumented.length > 0) {
    issues.push({
      type: 'undocumented',
      severity: 'high',
      count: undocumented.length,
      message: `${undocumented.length} endpoints not documented`,
      examples: undocumented.slice(0, 5)
    });
  }
  
  return issues;
}

function checkAuthenticationDocs(content) {
  const issues = [];
  
  const authPatterns = [
    { pattern: /bearer\s+token/i, name: 'Bearer token' },
    { pattern: /api[_-]?key/i, name: 'API key' },
    { pattern: /jwt/i, name: 'JWT' },
    { pattern: /oauth/i, name: 'OAuth' },
    { pattern: /basic\s+auth/i, name: 'Basic auth' }
  ];
  
  const hasAuthSection = content.match(/(?:^|\n)##+\s*(?:Authentication|Authorization).*/i);
  const hasExample = content.match(/Authorization:\s*\w+/i) || content.match(/Bearer\s+\w+/i);
  
  if (!hasAuthSection) {
    issues.push({
      type: 'auth-missing',
      severity: 'medium',
      message: 'No Authentication section found in documentation'
    });
  }
  
  let foundAuth = false;
  authPatterns.forEach(({ pattern }) => {
    if (pattern.test(content)) foundAuth = true;
  });
  
  if (!foundAuth && hasAuthSection) {
    issues.push({
      type: 'auth-incomplete',
      severity: 'low',
      message: 'Authentication section missing example or format details'
    });
  }
  
  return issues;
}

function checkErrorHandlingDocs(content) {
  const issues = [];
  
  const hasErrorSection = content.match(/(?:^|\n)##+\s*(?:Error|Error\s*Handling|Status\s*Codes?).*/i);
  const hasStatusCodes = content.match(/\b(?:400|401|403|404|500|502|503)\b/);
  
  if (!hasErrorSection) {
    issues.push({
      type: 'error-missing',
      severity: 'medium',
      message: 'No Error Handling section found'
    });
  }
  
  if (hasErrorSection && !hasStatusCodes) {
    issues.push({
      type: 'error-incomplete',
      severity: 'low',
      message: 'Error section missing HTTP status codes'
    });
  }
  
  return issues;
}

function checkExamples(content) {
  const issues = [];
  
  const curlExamples = content.match(/```curl[\s\S]*?```/g) || [];
  const jsExamples = content.match(/```javascript[\s\S]*?```/g) || [];
  const httpExamples = content.match(/```http[\s\S]*?```/g) || [];
  
  const hasExamples = curlExamples.length > 0 || jsExamples.length > 0 || httpExamples.length > 0;
  
  if (!hasExamples) {
    issues.push({
      type: 'examples-missing',
      severity: 'medium',
      message: 'No code examples found in documentation'
    });
  }
  
  const endpoints = extractEndpoints(content);
  if (endpoints.length > 0 && (curlExamples.length + jsExamples.length + httpExamples.length) < endpoints.length / 2) {
    issues.push({
      type: 'examples-insufficient',
      severity: 'low',
      message: 'Fewer examples than endpoints - consider adding more examples'
    });
  }
  
  return issues;
}

function validateRequestResponseSchemas(content) {
  const issues = [];
  
  const jsonSchemas = content.match(/```json[\s\S]*?"(?:properties|type|required|ref)"[\s\S]*?```/g) || [];
  const typeReferences = content.match(/(?:TypeScript|JS|Swagger|OpenAPI)\s+interface|type|schema/i) || [];
  
  if (content.includes('POST') || content.includes('PUT') || content.includes('PATCH')) {
    const hasRequestExample = content.match(/(?:Request|Body|Payload)[\s\S]*?```/i);
    
    if (!hasRequestExample && jsonSchemas.length < 2) {
      issues.push({
        type: 'request-missing',
        severity: 'medium',
        message: 'Missing request body examples for POST/PUT/PATCH endpoints'
      });
    }
  }
  
  const hasResponseExample = content.match(/(?:Response|Example|200|201|Success)[\s\S]*?```/i);
  
  if (!hasResponseExample) {
    issues.push({
      type: 'response-missing',
      severity: 'low',
      message: 'Missing response examples'
    });
  }
  
  return issues;
}

export const ApiDocsPlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      api_validate: {
        description: 'Validate API documentation completeness',
        args: {
          path: { type: 'string', description: 'Project path' },
          strict: { type: 'boolean', description: 'Enable strict validation' }
        },
        async execute({ path: projectPath, strict = false }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const docFiles = findApiDocFiles(dirToScan);
          
          if (docFiles.length === 0) {
            return {
              passed: false,
              error: 'No API documentation found',
              recommendation: 'Create API.md or OPENAPI.md documentation',
              searchedPath: dirToScan
            };
          }
          
          const mainDoc = docFiles[0];
          const content = fs.readFileSync(mainDoc, 'utf-8');
          const { headers, codeBlocks } = parseMarkdown(content);
          
          const endpoints = extractEndpoints(content);
          const documentedMethods = new Set(
            endpoints.map(e => e.method).filter(Boolean)
          );
          
          const authIssues = checkAuthenticationDocs(content);
          const errorIssues = checkErrorHandlingDocs(content);
          const exampleIssues = checkExamples(content);
          const schemaIssues = validateRequestResponseSchemas(content);
          const endpointIssues = validateEndpointDocs(content, endpoints);
          
          const allIssues = [...authIssues, ...errorIssues, ...exampleIssues, ...schemaIssues, ...endpointIssues];
          
          const docSectionCoverage = DOC_SECTIONS.map(section => ({
            name: section.name,
            present: headers.some(h => 
              section.patterns.some(p => h.toLowerCase().includes(p.toLowerCase()))
            )
          }));
          
          const presentSections = docSectionCoverage.filter(s => s.present).length;
          const coverage = Math.round((presentSections / DOC_SECTIONS.length) * 100);
          
          const critical = allIssues.filter(i => i.severity === 'high');
          const passed = critical.length === 0;
          
          return {
            passed,
            file: mainDoc,
            summary: {
              endpointsFound: endpoints.length,
              endpointsDocumented: documentedMethods.size,
              codeExamples: codeBlocks.length,
              docCoverage: coverage,
              issuesCount: allIssues.length
            },
            endpoints: {
              total: endpoints.length,
              byMethod: HTTP_METHODS.reduce((acc, method) => {
                acc[method] = endpoints.filter(e => e.method === method).length;
                return acc;
              }, {}),
              uniquePaths: new Set(endpoints.map(e => e.path)).size
            },
            sections: docSectionCoverage,
            issues: allIssues,
            recommendations: critical.length > 0 
              ? `Fix ${critical.length} critical documentation issues`
              : allIssues.length > 0 
                ? `Add ${allIssues.filter(i => i.severity === 'medium').length} missing sections`
                : 'API documentation is complete'
          };
        }
      },
      
      api_coverage: {
        description: 'Check API endpoint documentation coverage',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const docFiles = findApiDocFiles(dirToScan);
          
          if (docFiles.length === 0) {
            return {
              coverage: 0,
              documented: 0,
              total: 0,
              recommendation: 'No API documentation found'
            };
          }
          
          const mainDoc = docFiles[0];
          const content = fs.readFileSync(mainDoc, 'utf-8');
          const endpoints = extractEndpoints(content);
          
          const documentedPaths = new Set();
          HTTP_METHODS.forEach(method => {
            const regex = new RegExp(`${method}\\s+\`?(\\/[a-zA-Z0-9\\/\\{\\}:-]+)\`?`, 'g');
            let match;
            while ((match = regex.exec(content)) !== null) {
              documentedPaths.add(match[1].replace(/`/g, ''));
            }
          });
          
          const uniqueEndpoints = [...new Set(endpoints.map(e => e.path))];
          const documented = uniqueEndpoints.filter(p => documentedPaths.has(p));
          
          const coverage = uniqueEndpoints.length > 0 
            ? Math.round((documented.length / uniqueEndpoints.length) * 100) 
            : 0;
          
          return {
            coverage,
            documented: documented.length,
            total: uniqueEndpoints.length,
            undocumented: uniqueEndpoints.filter(p => !documentedPaths.has(p)).slice(0, 10),
            byMethod: HTTP_METHODS.map(method => {
              const methodEndpoints = endpoints.filter(e => e.method === method);
              const methodDocPaths = methodEndpoints.map(e => e.path);
              const methodDocs = methodDocPaths.filter(p => documentedPaths.has(p));
              
              return {
                method,
                total: methodEndpoints.length,
                documented: methodDocs.length,
                percentage: methodEndpoints.length > 0 
                  ? Math.round((methodDocs.length / methodEndpoints.length) * 100) 
                  : 100
              };
            }),
            recommendation: coverage === 100 
              ? 'All endpoints are documented'
              : `Document ${uniqueEndpoints.length - documented.length} undocumented endpoints`
          };
        }
      },
      
      api_checklist: {
        description: 'Generate API documentation checklist',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const docFiles = findApiDocFiles(dirToScan);
          
          const checklist = DOC_SECTIONS.map(section => ({
            section: section.name,
            present: false,
            items: section.patterns.map(p => ({ keyword: p, present: false }))
          }));
          
          let endpointsCount = 0;
          
          if (docFiles.length > 0) {
            const content = fs.readFileSync(docFiles[0], 'utf-8');
            const { headers, codeBlocks } = parseMarkdown(content);
            
            checklist.forEach(item => {
              item.present = headers.some(h => 
                item.items.some(i => h.toLowerCase().includes(i.keyword.toLowerCase()))
              );
            });
            
            endpointsCount = extractEndpoints(content).length;
          }
          
          const present = checklist.filter(i => i.present).length;
          
          return {
            checklist,
            progress: `${present}/${checklist.length} sections present`,
            percentage: Math.round((present / checklist.length) * 100),
            endpointsFound: endpointsCount,
            hasExamples: checklist.find(i => i.section === 'Examples')?.present,
            recommendations: checklist
              .filter(i => !i.present)
              .map(i => `Add "${i.section}" section`)
          };
        }
      }
    }
  };
};