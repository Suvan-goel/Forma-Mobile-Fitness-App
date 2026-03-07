/**
 * Custom hook for managing user-created workout templates
 */

import { useState, useEffect, useCallback } from 'react';
import { templatesService, CustomTemplate, CreateTemplatePayload } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface UseCustomTemplatesReturn {
  templates: CustomTemplate[];
  isLoading: boolean;
  createTemplate: (payload: CreateTemplatePayload) => Promise<boolean>;
  deleteTemplate: (id: string) => Promise<boolean>;
  refetch: () => Promise<void>;
}

export const useCustomTemplates = (): UseCustomTemplatesReturn => {
  const { user, isLoading: authLoading } = useAuth();
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTemplates = useCallback(async (uid: string) => {
    setIsLoading(true);
    try {
      const response = await templatesService.getAll(uid);
      if (response.success) {
        setTemplates(response.data);
      }
    } catch {
      // silently fail
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      fetchTemplates(user.id);
    } else if (!authLoading && !user) {
      setTemplates([]);
      setIsLoading(false);
    }
  }, [authLoading, user, fetchTemplates]);

  const refetch = useCallback(async () => {
    if (user) await fetchTemplates(user.id);
  }, [user, fetchTemplates]);

  const createTemplate = useCallback(async (payload: CreateTemplatePayload): Promise<boolean> => {
    if (!user) return false;
    try {
      const response = await templatesService.create(user.id, payload);
      if (response.success) {
        await fetchTemplates(user.id);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [user, fetchTemplates]);

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await templatesService.delete(id);
      if (response.success) {
        setTemplates(prev => prev.filter(t => t.id !== id));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  return { templates, isLoading: isLoading || authLoading, createTemplate, deleteTemplate, refetch };
};
