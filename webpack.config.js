const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: './src/main.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      "stream": require.resolve("stream-browserify"),
      "assert": require.resolve("assert/"),
      "buffer": require.resolve("buffer/")
    }
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'lib'),
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
};
