const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            // Style
            indent: ['error', 4, { SwitchCase: 1 }],
            semi: ['error', 'never'],
            quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
            'no-multiple-empty-lines': ['error', { max: 1 }],
            'padded-blocks': ['error', 'never'],

            // Best practices
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-param-reassign': ['error', { props: false }],
            'no-else-return': ['error', { allowElseIf: false }],
            'no-underscore-dangle': 'off',
        },
    },
    {
        ignores: ['src/http/html/**', 'node_modules/**'],
    },
]
