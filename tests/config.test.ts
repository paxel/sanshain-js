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
serviceName: test-service
timeout: 60
compression: true
provide:
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
    expect(config.serviceName).toBe('test-service');
    expect(config.timeout).toBe(60);
    expect(config.compression).toBe(true);
    expect(config.provide?.openApiFile).toBe('spec.yaml');
    expect(config.requires?.[0].serviceName).toBe('other-service');
  });

  it('should throw error on missing required field', () => {
    const yamlContent = `
serviceName: test-service
`;
    fs.writeFileSync(testYamlPath, yamlContent);

    expect(() => loadConfig(testYamlPath)).toThrow('Missing required field: sanshainUrl');
  });
});
