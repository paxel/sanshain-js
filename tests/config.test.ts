import { loadConfig } from '../src/config';
import fs from 'fs';
import path from 'path';

describe('Configuration parsing', () => {
  const testYamlPath = path.resolve(__dirname, 'test-sanshain.yaml');

  afterEach(() => {
    if (fs.existsSync(testYamlPath)) {
      fs.unlinkSync(testYamlPath);
    }
  });

  it('should parse a valid sanshain.yaml', () => {
    const yamlContent = `
sanshainUrl: http://localhost:3000
clientName: test-service
timeout: 60
compression: true
provide:
  serviceName: test-service
  openApiFile: spec.yaml
requires:
  - serviceName: other-service
    outputDirectory: gen
    endpoints:
      - method: GET
        path: /api
`;
    fs.writeFileSync(testYamlPath, yamlContent);

    const config = loadConfig(testYamlPath);
    expect(config.sanshainUrl).toBe('http://localhost:3000');
    expect(config.clientName).toBe('test-service');
    expect(config.timeout).toBe(60);
    expect(config.compression).toBe(true);
    expect(config.provide?.serviceName).toBe('test-service');
    expect(config.requires?.[0].serviceName).toBe('other-service');
  });

  it('should throw error on missing required field', () => {
    const yamlContent = `
sanshainUrl: http://localhost:3000
`;
    fs.writeFileSync(testYamlPath, yamlContent);

    expect(() => loadConfig(testYamlPath)).toThrow('Missing required field: clientName');
  });
});
