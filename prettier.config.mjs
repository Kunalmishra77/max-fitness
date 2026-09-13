/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 110,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
  overrides: [
    {
      files: ['*.md', '*.mdx'],
      options: { printWidth: 100, proseWrap: 'preserve' },
    },
    {
      files: ['*.prisma'],
      options: { printWidth: 120 },
    },
  ],
};
