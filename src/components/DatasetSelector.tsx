import { SelectableValue } from '@grafana/data';
import { Select } from '@grafana/ui';

import React, { useEffect } from 'react';

import { useAsync } from 'react-use';
import { ResourceSelectorProps } from 'types';

interface DatasetSelectorProps extends ResourceSelectorProps {
  projectId: string;
  value?: string;
  applyDefault?: boolean;
  disabled?: boolean;
  onChange: (v: SelectableValue) => void;
}

export const DatasetSelector: React.FC<DatasetSelectorProps> = ({
  apiClient,
  location,
  projectId,
  value,
  onChange,
  disabled,
  className,
  applyDefault,
}) => {
  const state = useAsync(async () => {
    const datasets = await apiClient.getDatasets(projectId, location);
    return datasets.map<SelectableValue<string>>((d) => ({ label: d, value: d }));
  }, [projectId, location]);

  useEffect(() => {
    if (!applyDefault) {
      return;
    }
    // Set default dataset when values are fetched
    if (!value) {
      if (state.value && state.value[0]) {
        onChange(state.value[0]);
      }
    } else {
      if (state.value && state.value.find((v) => v.value === value) === undefined) {
        // if value is set and newly fetched values does not contain selected value
        if (state.value.length > 0) {
          onChange(state.value[0]);
        }
      }
    }
  }, [state.value, value, location, applyDefault, onChange]);

  return (
    <Select
      className={className}
      value={value}
      options={state.value}
      onChange={onChange}
      disabled={disabled}
      isLoading={state.loading}
    />
  );
};
