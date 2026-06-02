import type { QACriticidade, QATipoSistema } from '@/types';

export interface HUFormState {
  projeto: string;
  sprint: string;
  hu: string;
  tipoSistema: QATipoSistema;
  criticidade: QACriticidade;
}

interface Props {
  value: HUFormState;
  onChange: (next: HUFormState) => void;
  disabled?: boolean;
}

export function HUForm({ value, onChange, disabled }: Props) {
  const set = <K extends keyof HUFormState>(key: K, v: HUFormState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>História de Usuário</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Cole a HU completa (incluindo critérios de aceite, se houver) para a IA gerar casos
          específicos.
        </p>
      </header>

      <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-group">
          <label htmlFor="qa-projeto">Projeto</label>
          <input
            id="qa-projeto"
            className="input"
            type="text"
            value={value.projeto}
            placeholder="Ex: Portal Cliente, App Mobile..."
            onChange={(e) => set('projeto', e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="form-group">
          <label htmlFor="qa-sprint">Sprint</label>
          <input
            id="qa-sprint"
            className="input"
            type="text"
            value={value.sprint}
            placeholder="Ex: Sprint 42, 2026-Q2-S3..."
            onChange={(e) => set('sprint', e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="qa-hu">Texto da HU</label>
        <textarea
          id="qa-hu"
          className="input"
          rows={10}
          value={value.hu}
          placeholder={
            'Como [perfil de usuário],\nEu quero [ação/funcionalidade],\nPara que [benefício/valor].\n\nCritérios de aceite:\n- ...\n- ...'
          }
          onChange={(e) => set('hu', e.target.value)}
          disabled={disabled}
          style={{ resize: 'vertical', minHeight: 160, fontFamily: 'inherit', fontSize: 14 }}
        />
        <small className="hint">Dica: inclua critérios de aceite para casos mais precisos.</small>
      </div>

      <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-group">
          <label htmlFor="qa-tipo">Tipo de Sistema</label>
          <select
            id="qa-tipo"
            className="input"
            value={value.tipoSistema}
            onChange={(e) => set('tipoSistema', e.target.value as QATipoSistema)}
            disabled={disabled}
          >
            <option value="web">Web</option>
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
            <option value="api">API / Backend</option>
            <option value="ia">Sistema com IA</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="qa-criticidade">Criticidade</label>
          <select
            id="qa-criticidade"
            className="input"
            value={value.criticidade}
            onChange={(e) => set('criticidade', e.target.value as QACriticidade)}
            disabled={disabled}
          >
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </div>
      </div>
    </div>
  );
}
