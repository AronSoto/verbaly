// a comment is one line of at most 100 characters: the longer why belongs to the changelog
const MAX = 100;
const DIRECTIVE =
  /^\s*(eslint|prettier-|@ts-|@vitest-|@type|global|v8 ignore|c8 |istanbul|#__PURE__)/;

export const oneLine = {
  meta: {
    type: 'problem',
    docs: { description: 'a comment is one line of at most 100 characters' },
    schema: [],
    messages: {
      run: 'comment block of {{lines}} lines: keep one line and move the why to the changelog entry',
      long: 'comment line is {{length}} characters: keep it under {{max}}',
      block: 'block comments are for tool directives only: use //',
    },
  },
  create(context) {
    const source = context.sourceCode;
    const ownLine = (comment) =>
      source.lines[comment.loc.start.line - 1].slice(0, comment.loc.start.column).trim() === '';

    let runStart = null;
    let runLength = 0;
    const flush = () => {
      if (runLength > 1) {
        context.report({ loc: runStart.loc, messageId: 'run', data: { lines: runLength } });
      }
      runStart = null;
      runLength = 0;
    };

    for (const comment of source.getAllComments()) {
      if (DIRECTIVE.test(comment.value)) continue;
      if (comment.type === 'Block') {
        flush();
        context.report({ loc: comment.loc, messageId: 'block' });
        continue;
      }
      const { length } = source.lines[comment.loc.start.line - 1];
      if (length > MAX) {
        context.report({ loc: comment.loc, messageId: 'long', data: { length, max: MAX } });
      }
      if (!ownLine(comment)) {
        flush();
        continue;
      }
      if (runStart && comment.loc.start.line === runStart.loc.start.line + runLength) {
        runLength += 1;
      } else {
        flush();
        runStart = comment;
        runLength = 1;
      }
    }
    flush();
    return {};
  },
};
