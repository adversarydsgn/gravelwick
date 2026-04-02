import { supabase } from '../supabase/client';
import type { CalendarEvent } from '@/types';

export async function shouldSkipMeeting(event: CalendarEvent): Promise<boolean> {
  const { data: rules } = await supabase.from('blacklist_rules').select('*');
  if (!rules) return false;

  const titleLower = event.title.toLowerCase();
  const attendeeEmails = event.attendees.map((a) => a.email.toLowerCase());
  const attendeeDomains = attendeeEmails.map((e) => e.split('@')[1]).filter(Boolean);

  for (const rule of rules) {
    switch (rule.rule_type) {
      case 'title_keyword':
        if (titleLower.includes(rule.value.toLowerCase())) {
          console.log(`[blacklist] Skipping "${event.title}" — title keyword: ${rule.value}`);
          return true;
        }
        break;
      case 'email_domain':
        if (attendeeDomains.includes(rule.value.toLowerCase())) {
          console.log(`[blacklist] Skipping "${event.title}" — email domain: ${rule.value}`);
          return true;
        }
        break;
      case 'email_address':
        if (attendeeEmails.includes(rule.value.toLowerCase())) {
          console.log(`[blacklist] Skipping "${event.title}" — email address: ${rule.value}`);
          return true;
        }
        break;
      case 'calendar_id':
        if (event.calendar_id === rule.value) {
          console.log(`[blacklist] Skipping "${event.title}" — calendar ID: ${rule.value}`);
          return true;
        }
        break;
    }
  }

  return false;
}
