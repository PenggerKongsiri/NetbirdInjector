import { spawnSync } from 'node:child_process';

const context = process.env.NIM_DOCKER_CONTEXT || (process.platform === 'win32' ? 'desktop-linux' : '');
const prefix = context ? ['--context', context] : [];
const image = 'nim-injector-lifecycle-test:local';

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', [...prefix, ...args], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Docker is unavailable: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) throw new Error(`Docker lifecycle command failed with status ${result.status}`);
  return result.status;
}

try {
  docker(['build', '--file', 'tools/lifecycle/Containerfile', '--tag', image, '.']);
  docker(['run', '--rm', '--name', 'nim-injector-lifecycle-test', image]);
} finally {
  docker(['image', 'rm', '--force', image], { allowFailure: true });
}
