/**
 * A workflow's name is its file name under the workflows directory: letters, digits, space, `_`, `-`
 * and `.`, 1 to 64 characters, not starting with a space or a dot. The bridge refuses anything else
 * before building a path from it; the app refuses the same names before asking.
 */
export const WORKFLOW_NAME = /^[A-Za-z0-9_-][A-Za-z0-9 _.-]{0,63}$/;
