import { FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import type { Project } from '@/types';

interface Props {
  project: Project;
  onChange: (project: Project) => void;
}

export function ProjectForm({ project, onChange }: Props) {
  const set = <K extends keyof Project>(key: K, value: Project[K]) =>
    onChange({ ...project, [key]: value });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FileText size={20} style={{ color: 'var(--primary)' }} />
          Dados do Projeto
        </CardTitle>
      </CardHeader>

      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="projectName">Nome do Projeto *</label>
          <input
            id="projectName"
            placeholder="Sistema X"
            value={project.projectName}
            onChange={(e) => set('projectName', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="clientName">Nome do Cliente *</label>
          <input
            id="clientName"
            placeholder="Cliente X"
            value={project.clientName}
            onChange={(e) => set('clientName', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="sprintName">Nome da Sprint *</label>
          <input
            id="sprintName"
            placeholder="Sprint X"
            value={project.sprintName}
            onChange={(e) => set('sprintName', e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="version">Versão *</label>
          <input
            id="version"
            placeholder="1.0"
            value={project.version}
            onChange={(e) => set('version', e.target.value)}
          />
        </div>
        <div className="form-group full">
          <label htmlFor="redator">Nome do Redator *</label>
          <input
            id="redator"
            placeholder="Seu nome"
            value={project.redator}
            onChange={(e) => set('redator', e.target.value)}
          />
        </div>

        <div className="form-group full">
          <label htmlFor="sprintObjective">Objetivo da Sprint</label>
          <textarea
            id="sprintObjective"
            rows={3}
            placeholder="Descreva o objetivo principal da sprint..."
            value={project.sprintObjective}
            onChange={(e) => set('sprintObjective', e.target.value)}
          />
        </div>

        <div className="form-group full">
          <label htmlFor="testScope">Escopo de Testes</label>
          <textarea
            id="testScope"
            rows={4}
            placeholder="Descreva o que será coberto pelos testes..."
            value={project.testScope}
            onChange={(e) => set('testScope', e.target.value)}
          />
        </div>
      </div>
    </Card>
  );
}
