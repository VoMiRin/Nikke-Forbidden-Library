// Keep scene boundaries intact: citations spanning two blocks cannot identify one scene.
export const splitScriptBlocks = (text) => {
  const blocks = new Map();
  for (const block of text.split(/^@@@SCRIPT_ID:\s*/m).slice(1)) {
    const newline = block.indexOf('\n');
    if (newline < 0) continue;
    const id = block.slice(0, newline).trim();
    if (!id || blocks.has(id)) throw new Error(`Duplicate or empty script ID: ${id}`);
    const content = block.slice(newline + 1).replace(/^@@@SUB_TITLE:[^\n]*\n?/i, '').trim();
    blocks.set(id, content);
  }
  return blocks;
};
