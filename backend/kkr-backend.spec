# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [("alembic", "alembic"), ("alembic.ini", ".")]
binaries = []
hiddenimports = [
    "passlib.handlers.bcrypt",
    "psycopg_binary",
    "pydantic_settings",
    "email_validator",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
]

hiddenimports += collect_submodules("src")

for package in (
    "supabase",
    "storage3",
    "postgrest",
    "realtime",
    "supabase_auth",
    "supabase_functions",
    "gotrue",
    "httpx",
    "httpcore",
):
    try:
        package_datas, package_binaries, package_hiddenimports = collect_all(package)
        datas += package_datas
        binaries += package_binaries
        hiddenimports += package_hiddenimports
    except Exception:
        pass

analysis = Analysis(
    ["run_prod.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    noarchive=False,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="kkr-backend",
    console=False,
)

coll = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=True,
    name="kkr-backend",
)

