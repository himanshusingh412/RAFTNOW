import React from 'react';
import { Image, Linking, ScrollView, Text, View } from 'react-native';
import { Ticket, istTime, statusLabel } from './api';
import { Banner, Button, Card, Header, c, ui } from './ui';

/** E-ticket (C-13): signed QR, 6-character code, meeting point. Renders from the offline cache too. */
export function TicketView({ ticket, onClose, justBooked, offline }: { ticket: Ticket; onClose: () => void; justBooked?: boolean; offline?: boolean }) {
  return (
    <View style={ui.screen}>
      <Header title={justBooked ? 'Booking confirmed' : 'Your ticket'} onBack={onClose} />
      <ScrollView contentContainerStyle={ui.pad}>
        {justBooked && <Banner tone="ok">You’re booked! We’ve sent the ticket by SMS and email. It’s also saved on this phone, so it opens without signal.</Banner>}
        {offline && <Banner tone="warn">Offline copy. The QR is still valid at the river.</Banner>}
        <Card style={{ alignItems: 'center' }}>
          <Image source={{ uri: ticket.qr_data_url }} style={{ width: 240, height: 240, backgroundColor: '#fff', borderRadius: 12 }} resizeMode="contain" accessibilityLabel="Signed booking QR code" />
          <Text style={{ color: c.aqua, fontSize: 30, fontWeight: '900', letterSpacing: 4, marginTop: 12 }} accessibilityLabel={`Booking code ${ticket.display_code.split('').join(' ')}`}>
            {ticket.display_code}
          </Text>
          <Text style={ui.meta}>{statusLabel(ticket.status)}</Text>
          <Text style={[ui.meta, { textAlign: 'center', marginTop: 8 }]}>Show this QR, or tell the operator your code, at the meeting point.</Text>
        </Card>
        <Card>
          <Text style={ui.h2}>{ticket.trip_title}</Text>
          <Text style={ui.body}>{istTime(ticket.start_time)} IST</Text>
          {ticket.stretch_name ? <Text style={ui.meta}>{ticket.stretch_name}</Text> : null}
          <Text style={ui.meta}>Operated by {ticket.vendor_name}</Text>
          <Text style={[ui.label, { marginTop: 12 }]}>Meeting point</Text>
          <Text style={ui.body}>{ticket.meeting_point}</Text>
          <Text style={ui.meta}>Please report 30 minutes before departure.</Text>
          <Button
            tone="ghost"
            label="Open in Google Maps"
            onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ticket.meeting_point}, Rishikesh`)}`)}
          />
          <Text style={[ui.label, { marginTop: 12 }]}>Guests</Text>
          {ticket.guests.map((g, i) => (
            <Text key={i} style={ui.body}>
              {g.name} · {g.age}
            </Text>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}
