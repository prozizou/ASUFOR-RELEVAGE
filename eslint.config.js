import globals from 'globals';

export default [
    {
        ignores: ['node_modules/**', 'icons/**'],
    },
    {
        files: ['JS/**/*.js', 'sw.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.serviceworker,
                firebase: 'readonly',
                Tesseract: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-undef': 'error',
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'warn',
        },
    },
    {
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
    },
];
