#!/usr/bin/env python3
"""
RSVP Restore Script
===================
This script restores RSVP data from backup files.

Usage:
    python3 restore_rsvp.py [backup_file]

    If no backup file is specified, it will use the latest JSON backup.

Examples:
    python3 restore_rsvp.py                           # Use latest backup
    python3 restore_rsvp.py rsvp_backup_2026-04-12.json  # Use specific backup
"""

import sqlite3
import json
import csv
import os
import sys
from datetime import datetime

# Configuration
DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'wedding.db')
BACKUP_DIR = os.path.dirname(__file__)

def get_latest_backup():
    """Find the latest JSON backup file"""
    backups = [f for f in os.listdir(BACKUP_DIR) if f.startswith('rsvp_backup_') and f.endswith('.json')]
    if not backups:
        return None
    backups.sort(reverse=True)
    return os.path.join(BACKUP_DIR, backups[0])

def restore_from_json(backup_file):
    """Restore RSVP data from JSON backup"""
    print(f"📂 Loading backup: {backup_file}")
    
    with open(backup_file, 'r', encoding='utf-8') as f:
        backup_data = json.load(f)
    
    rsvps = backup_data.get('data', [])
    print(f"   Found {len(rsvps)} records in backup")
    print(f"   Backup date: {backup_data.get('backup_date', 'Unknown')}")
    print(f"   Total guests: {backup_data.get('total_guests', 'Unknown')}")
    
    return rsvps

def restore_from_csv(backup_file):
    """Restore RSVP data from CSV backup"""
    print(f"📂 Loading CSV backup: {backup_file}")
    
    rsvps = []
    with open(backup_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Convert party_size to int
            if 'party_size' in row:
                row['party_size'] = int(row['party_size']) if row['party_size'] else 1
            if 'id' in row:
                row['id'] = int(row['id']) if row['id'] else None
            if 'barcode_sent' in row:
                row['barcode_sent'] = int(row['barcode_sent']) if row['barcode_sent'] else 0
            rsvps.append(row)
    
    print(f"   Found {len(rsvps)} records in backup")
    return rsvps

def restore_to_database(rsvps):
    """Restore RSVPs to the database"""
    print(f"\n💾 Restoring to database: {DB_PATH}")
    
    # Ensure database directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create table if not exists
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rsvp (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            email      TEXT,
            phone      TEXT,
            attendance TEXT NOT NULL,
            guest_of   TEXT,
            party_size INTEGER DEFAULT 1,
            dietary    TEXT,
            message    TEXT,
            barcode    TEXT UNIQUE,
            barcode_sent INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            scanned_at DATETIME
        )
    ''')
    
    # Clear existing data
    cursor.execute('DELETE FROM rsvp')
    print("   Cleared existing RSVP data")
    
    # Insert restored data
    inserted = 0
    errors = 0
    
    for rsvp in rsvps:
        try:
            cursor.execute('''
                INSERT INTO rsvp (name, email, phone, attendance, guest_of, barcode, party_size, dietary, message, barcode_sent, created_at, scanned_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                rsvp.get('name'),
                rsvp.get('email'),
                rsvp.get('phone'),
                rsvp.get('attendance'),
                rsvp.get('guest_of'),
                rsvp.get('barcode'),
                rsvp.get('party_size', 1),
                rsvp.get('dietary'),
                rsvp.get('message'),
                rsvp.get('barcode_sent', 0),
                rsvp.get('created_at'),
                rsvp.get('scanned_at')
            ))
            inserted += 1
        except Exception as e:
            errors += 1
            print(f"   ⚠️ Error inserting {rsvp.get('name', 'Unknown')}: {e}")
    
    conn.commit()
    
    # Verify
    cursor.execute('SELECT COUNT(*) FROM rsvp')
    count = cursor.fetchone()[0]
    cursor.execute('SELECT SUM(party_size) FROM rsvp')
    total_guests = cursor.fetchone()[0] or 0
    
    conn.close()
    
    print(f"\n✅ Restore complete!")
    print(f"   Inserted: {inserted}")
    print(f"   Errors: {errors}")
    print(f"   Total records: {count}")
    print(f"   Total guests: {total_guests}")
    
    return inserted, errors

def main():
    print("=" * 60)
    print("        RSVP BACKUP RESTORE SCRIPT")
    print("=" * 60)
    
    # Determine backup file
    if len(sys.argv) > 1:
        backup_file = sys.argv[1]
        if not os.path.isabs(backup_file):
            backup_file = os.path.join(BACKUP_DIR, backup_file)
    else:
        backup_file = get_latest_backup()
        if not backup_file:
            print("❌ No backup files found!")
            sys.exit(1)
        print(f"📌 Using latest backup: {os.path.basename(backup_file)}")
    
    if not os.path.exists(backup_file):
        print(f"❌ Backup file not found: {backup_file}")
        sys.exit(1)
    
    # Restore based on file type
    if backup_file.endswith('.json'):
        rsvps = restore_from_json(backup_file)
    elif backup_file.endswith('.csv'):
        rsvps = restore_from_csv(backup_file)
    else:
        print(f"❌ Unsupported backup format: {backup_file}")
        sys.exit(1)
    
    if not rsvps:
        print("❌ No RSVP data found in backup!")
        sys.exit(1)
    
    # Ask for confirmation
    print(f"\n⚠️  This will REPLACE all existing RSVP data!")
    response = input("Continue? (yes/no): ")
    if response.lower() != 'yes':
        print("❌ Restore cancelled.")
        sys.exit(0)
    
    # Restore to database
    restore_to_database(rsvps)
    
    print("\n🔒 Backup restored successfully!")

if __name__ == '__main__':
    main()
