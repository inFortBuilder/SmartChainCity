<?php
// Anúncios de exemplo do marketplace. Em produção vêm de /v1/market/listings (ver docs/06).
// category: property | land | avatar | item. price em SCITY.
return [
    ['id' => 'p-1001', 'category' => 'property', 'name' => 'Casa T1',          'badge' => 'T1', 'level' => 1, 'income' => '12/dia', 'wear' => 30, 'location' => '12,12',  'roi' => 50, 'price' => 1200,  'rarity' => 'common'],
    ['id' => 'p-1002', 'category' => 'property', 'name' => 'Casa T2',          'badge' => 'T2', 'level' => 2, 'income' => '18/dia', 'wear' => 82, 'location' => '-4,7',   'roi' => 46, 'price' => 2100,  'rarity' => 'rare'],
    ['id' => 'p-1003', 'category' => 'property', 'name' => 'Residencial 3',    'badge' => 'R3', 'level' => 1, 'income' => '40/dia', 'wear' => 95, 'location' => '3,-9',   'roi' => 38, 'price' => 6400,  'rarity' => 'epic'],
    ['id' => 'p-1004', 'category' => 'property', 'name' => 'Residencial 1',    'badge' => 'R1', 'level' => 3, 'income' => '65/dia', 'wear' => 70, 'location' => '0,2',    'roi' => 31, 'price' => 15800, 'rarity' => 'legendary'],
    ['id' => 'l-2001', 'category' => 'land',     'name' => 'Lote A1 (5,-3)',   'badge' => 'A1', 'level' => 1, 'income' => '—',      'wear' => 100, 'location' => '5,-3',  'roi' => 0,  'price' => 900,   'rarity' => 'rare'],
    ['id' => 'l-2002', 'category' => 'land',     'name' => 'Lote A1 (-11,8)',  'badge' => 'A1', 'level' => 1, 'income' => '—',      'wear' => 100, 'location' => '-11,8', 'roi' => 0,  'price' => 720,   'rarity' => 'common'],
    ['id' => 'l-2003', 'category' => 'land',     'name' => 'Slot rural A3',    'badge' => 'A3', 'level' => 1, 'income' => '—',      'wear' => 100, 'location' => '61,40', 'roi' => 0,  'price' => 1500,  'rarity' => 'common'],
    ['id' => 'a-3001', 'category' => 'avatar',   'name' => 'Médico',           'badge' => 'L',  'level' => 1, 'income' => '250/dia', 'wear' => 100, 'location' => '—',    'roi' => 0,  'price' => 4200,  'rarity' => 'legendary'],
    ['id' => 'a-3002', 'category' => 'avatar',   'name' => 'Cozinheiro',       'badge' => 'E',  'level' => 1, 'income' => '180/dia', 'wear' => 100, 'location' => '—',    'roi' => 0,  'price' => 2600,  'rarity' => 'epic'],
    ['id' => 'a-3003', 'category' => 'avatar',   'name' => 'Padeiro',          'badge' => 'C',  'level' => 1, 'income' => '125/dia', 'wear' => 100, 'location' => '—',    'roi' => 0,  'price' => 1100,  'rarity' => 'common'],
    ['id' => 'i-4001', 'category' => 'item',     'name' => 'Estetoscópio',     'badge' => '+30%', 'level' => 1, 'income' => '3 dias', 'wear' => 100, 'location' => '—',  'roi' => 0,  'price' => 80,    'rarity' => 'rare'],
    ['id' => 'i-4002', 'category' => 'item',     'name' => 'Cama',             'badge' => '6h',  'level' => 1, 'income' => '2 turnos', 'wear' => 100, 'location' => '—', 'roi' => 0,  'price' => 150,   'rarity' => 'common'],
];
