# Getting Started with Python and uv

This project uses [uv](https://docs.astral.sh/uv/) to manage Python versions, dependencies, and virtual environments. uv replaces the traditional stack of `pyenv` + `pip` + `venv` (or `conda`) with a single binary. It resolves and installs packages in seconds rather than minutes, and it handles Python version management so you never need to install Python separately.

If you already have Python and a package manager you are comfortable with, uv is not strictly required. But the project's READMEs assume uv for all commands (`uv sync`, `uv run`), so following along will be simplest if you install it.

## macOS

### Install uv

The fastest path is Homebrew:

```bash
brew install uv
```

If you do not use Homebrew, the standalone installer works on any Mac:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

After installation, restart your terminal (or run `source ~/.zshrc`) so the `uv` command is on your PATH.

Verify it works:

```bash
uv --version
```

### Install Python through uv

uv can install and manage Python versions directly. You do not need to install Python from python.org or through Homebrew first.

```bash
# Install the Python version this project uses
uv python install 3.12
```

uv stores its Python installations in `~/.local/share/uv/python/` and selects the correct version automatically when you run `uv sync` in a project directory.

### Set up a project

From any project directory that contains a `pyproject.toml`:

```bash
# Install all dependencies into a .venv directory
uv sync

# Run a command using the project's virtual environment
uv run python -c "print('it works')"
```

`uv sync` creates the `.venv` directory, installs the correct Python version if needed, and installs all dependencies. `uv run` executes commands inside that environment without requiring you to activate it manually.

## Windows

### Install uv

Open PowerShell and run:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Alternatively, if you use winget:

```powershell
winget install astral-sh.uv
```

Close and reopen your terminal after installation so the `uv` command is available.

Verify it works:

```powershell
uv --version
```

### Install Python through uv

As on macOS, uv handles Python installation. You do not need to download Python from python.org or the Microsoft Store.

```powershell
# Install the Python version this project uses
uv python install 3.12
```

uv stores Python installations under `%LOCALAPPDATA%\uv\python\` and selects the correct version automatically per project.

### Set up a project

From any project directory that contains a `pyproject.toml`:

```powershell
# Install all dependencies into a .venv directory
uv sync

# Run a command using the project's virtual environment
uv run python -c "print('it works')"
```

The behavior is identical to macOS. `uv sync` creates the environment and installs everything; `uv run` executes inside it.

### Windows-specific notes

- Use PowerShell or Windows Terminal rather than the legacy Command Prompt (`cmd.exe`). The uv installer targets PowerShell and some commands differ in cmd.
- If you see permission errors during installation, run PowerShell as Administrator for the install step only. Normal usage does not require elevated privileges.
- Windows Defender may briefly scan newly created `.venv` directories. This is normal and only affects the first `uv sync`.

## Common uv commands

| Command | What it does |
|---------|-------------|
| `uv sync` | Install or update all dependencies into `.venv` |
| `uv run <cmd>` | Run a command inside the project's virtual environment |
| `uv add <pkg>` | Add a dependency to `pyproject.toml` and install it |
| `uv remove <pkg>` | Remove a dependency from `pyproject.toml` |
| `uv lock` | Regenerate the lockfile without installing |
| `uv python install 3.12` | Install a specific Python version |
| `uv python list` | Show all Python versions uv knows about |
| `uv self update` | Update uv itself to the latest release |

## Learn more

- [uv documentation](https://docs.astral.sh/uv/) — the official reference, including guides on workspaces, scripts, and publishing packages
- [uv GitHub repository](https://github.com/astral-sh/uv) — release notes, issue tracker, and source code
- [Python.org beginner's guide](https://wiki.python.org/moin/BeginnersGuide) — if you are new to Python itself, start here for language fundamentals
- [Real Python](https://realpython.com/) — tutorials covering Python basics through advanced topics, with a practical focus
- [Astral blog](https://astral.sh/blog) — announcements and deep dives on uv features as they ship
