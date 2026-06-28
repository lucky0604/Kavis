import { describe, it, expect } from 'vitest';
import { SearchReplaceEngine, parsePatch } from './search-replace';

describe('parsePatch', () => {
  it('should parse a single valid block', () => {
    const patch = `<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;
    const result = parsePatch(patch);
    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks?.[0].search).toBe('const x = 1;');
    expect(result.blocks?.[0].replace).toBe('const x = 2;');
  });

  it('should parse multiple blocks', () => {
    const patch = `<<<<<<< SEARCH
block 1 search
=======
block 1 replace
>>>>>>> REPLACE

<<<<<<< SEARCH
block 2 search
=======
block 2 replace
>>>>>>> REPLACE`;
    const result = parsePatch(patch);
    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks?.[0].search).toBe('block 1 search');
    expect(result.blocks?.[0].replace).toBe('block 1 replace');
    expect(result.blocks?.[1].search).toBe('block 2 search');
    expect(result.blocks?.[1].replace).toBe('block 2 replace');
  });

  it('should return error for unclosed block', () => {
    const patch = `<<<<<<< SEARCH
const x = 1;
=======
const x = 2;`;
    const result = parsePatch(patch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unclosed Search-Replace block');
  });

  it('should return error for unexpected SEARCH inside SEARCH', () => {
    const patch = `<<<<<<< SEARCH
<<<<<<< SEARCH
=======
>>>>>>> REPLACE`;
    const result = parsePatch(patch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected <<<<<<< SEARCH');
  });
});

describe('SearchReplaceEngine', () => {
  const engine = new SearchReplaceEngine();

  it('should apply exact match (Level 1)', () => {
    const fileContent = `function test() {
  console.log("hello");
  return true;
}`;
    const patch = `<<<<<<< SEARCH
  console.log("hello");
=======
  console.log("hello world");
  console.log("done");
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(true);
    expect(result.newContent).toBe(`function test() {
  console.log("hello world");
  console.log("done");
  return true;
}`);
  });

  it('should apply fuzzy match with adaptive indentation (Level 2)', () => {
    const fileContent = `function test() {
    console.log("hello");
    return true;
}`;
    // Patch has 2 spaces indentation, but file has 4 spaces
    const patch = `<<<<<<< SEARCH
  console.log("hello");
=======
  console.log("hello world");
  console.log("done");
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(true);
    expect(result.newContent).toBe(`function test() {
    console.log("hello world");
    console.log("done");
    return true;
}`);
  });

  it('should handle CRLF line endings', () => {
    const fileContent = `function test() {\r\n  console.log("hello");\r\n  return true;\r\n}`;
    const patch = `<<<<<<< SEARCH
  console.log("hello");
=======
  console.log("hello world");
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(true);
    expect(result.newContent).toBe(`function test() {\r\n  console.log("hello world");\r\n  return true;\r\n}`);
  });

  it('should support creating a new file with empty SEARCH block', () => {
    const fileContent = '';
    const patch = `<<<<<<< SEARCH
=======
const x = 1;
export default x;
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(true);
    expect(result.newContent).toBe(`const x = 1;
export default x;`);
  });

  it('should reject empty SEARCH block if file is not empty', () => {
    const fileContent = 'const existing = 1;';
    const patch = `<<<<<<< SEARCH
=======
const x = 1;
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty SEARCH block is only allowed');
  });

  it('should return error if SEARCH block is not found', () => {
    const fileContent = 'const x = 1;';
    const patch = `<<<<<<< SEARCH
const y = 2;
=======
const y = 3;
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find a match');
  });

  it('should return error if SEARCH block matches multiple locations', () => {
    const fileContent = `const x = 1;
const x = 1;`;
    const patch = `<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Found multiple matching locations');
  });

  it('should perform atomic rollback if any block fails', () => {
    const fileContent = `const a = 1;
const b = 2;`;
    const patch = `<<<<<<< SEARCH
const a = 1;
=======
const a = 10;
>>>>>>> REPLACE

<<<<<<< SEARCH
const nonExistent = 999;
=======
const c = 3;
>>>>>>> REPLACE`;

    const result = engine.applyPatch(fileContent, patch);
    expect(result.success).toBe(false);
    expect(result.newContent).toBe(fileContent); // Unchanged!
    expect(result.error).toContain('Could not find a match');
  });
});
