import { describe, expect, it } from 'vitest';
import { contracts, hardware, modules, programs, servers } from '../../content';
import { PROGRAM_KINDS } from '../../content/schema';
import { stagesOf } from '../../core';
import { ICON_NAMES, PROGRAM_GROUPS, fileIcon, groupOf, moduleIcon, objectiveIcon, programIcon, slotIcon } from './Icon';

describe('the icon kit', () => {
  it('has an icon and a shelf for every kind of program', () => {
    for (const kind of PROGRAM_KINDS) {
      expect(ICON_NAMES, kind).toContain(programIcon(kind));
      expect(PROGRAM_GROUPS.filter((group) => (group.kinds as readonly string[]).includes(kind)), kind).toHaveLength(1);
    }
    for (const program of programs) expect(PROGRAM_GROUPS.map((group) => group.id)).toContain(groupOf(program.kind));
  });

  it('gives each kind of program its own picture', () => {
    expect(new Set(PROGRAM_KINDS.map(programIcon)).size).toBe(PROGRAM_KINDS.length);
  });

  it('has its own icon for every hardware slot and module', () => {
    const slots = [...new Set(hardware.map((part) => part.slot))];
    expect(new Set(slots.map(slotIcon)).size).toBe(slots.length);
    expect(new Set(modules.map((module) => moduleIcon(module.id))).size).toBe(modules.length);
    for (const module of modules) expect(moduleIcon(module.id), module.id).not.toBe('module');
  });

  it('has an icon for every kind of job', () => {
    const kinds = new Set(contracts.flatMap((contract) => stagesOf(contract).map((stage) => stage.objective.kind)));
    expect(new Set([...kinds].map(objectiveIcon)).size).toBe(kinds.size);
    for (const kind of kinds) expect(objectiveIcon(kind), kind).not.toBe('file');
  });

  it('knows every kind of file the servers hold', () => {
    const endings = new Set(servers.flatMap((server) => server.files.map((file) => file.name.slice(file.name.lastIndexOf('.') + 1))));
    for (const ending of endings) {
      if (ending !== 'txt' && ending !== 'log') expect(fileIcon(`x.${ending}`), ending).not.toBe('file');
    }
    expect(fileIcon('notes.txt', true)).toBe('lock');
  });
});
