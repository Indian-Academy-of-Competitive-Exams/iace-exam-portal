import nativewindPreset from 'nativewind/preset';
import preset from './tailwind.preset.native.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [nativewindPreset, preset],
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
};
