# Contributing to wepl4y

Thank you for your interest in contributing to wepl4y. This document provides guidelines and instructions for contributing code, reporting bugs, and suggesting enhancements.

---

## Code of Conduct

Please be respectful, collaborative, and considerate in all interactions within this project.

---

## Getting Started

### Prerequisites
- **Node.js**: v18 or later (`node -v`)
- **npm**: v9 or later
- **Rust toolchain**: latest stable (`rustc --version`, `cargo --version`)
- **Tauri prerequisites**:
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libasound2-dev`, `libssl-dev`, `build-essential`, `pkg-config`
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2 runtime

### Local Development Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/flawme/wepl4y.git
   cd wepl4y
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

4. **Run type checks and linters**:
   ```bash
   npm run build
   cargo check --manifest-path src-tauri/Cargo.toml
   ```

---

## Pull Request Guidelines

1. **Branch Naming**:
   - `feature/your-feature-name`
   - `fix/issue-description`
   - `chore/update-dependencies`

2. **Commit Messages**:
   - Follow standard conventional commit format (e.g., `feat: add equalizer animation`, `fix: volume slider boundary check`).

3. **Code Style**:
   - Keep code modular, type-safe (TypeScript strict mode), and performant.
   - For backend changes, ensure zero compiler warnings with `cargo check`.
   - Maintain cross-platform portability across Linux, macOS, and Windows.

4. **Testing**:
   - Verify that your changes build and run locally without errors on both the full player and mini-player windows.

---

## Reporting Issues

- Use the GitHub issue templates for Bug Reports or Feature Requests.
- Include OS version, logs, steps to reproduce, and screenshots if applicable.
