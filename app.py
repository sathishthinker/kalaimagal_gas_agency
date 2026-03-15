import json
import os
from datetime import date
from flask import Flask, request, jsonify, render_template, abort

from models import (
    init_db, seed_db,
    Firm, Product, Stock, Customer, Transaction, InventoryLog, ProductHistory
)

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False

try:
    engine, Session = init_db()
    seed_db(Session)
except Exception as e:
    import traceback
    print("STARTUP ERROR:", e)
    traceback.print_exc()
    raise


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _err(msg, status=400):
    return jsonify({'error': msg}), status


def _get_product_by_size(session, firm_id, size_id):
    return session.query(Product).filter_by(
        firm_id=firm_id, size_id=size_id, active=True).first()


def _adjust_stock(session, product_id, filled_delta=0, empty_delta=0):
    """Apply deltas to a stock row. Raises ValueError if result goes negative."""
    s = session.query(Stock).filter_by(product_id=product_id).first()
    if not s:
        s = Stock(product_id=product_id, filled_qty=0, empty_qty=0)
        session.add(s)
    new_f = s.filled_qty + filled_delta
    new_e = s.empty_qty  + empty_delta
    if new_f < 0:
        raise ValueError(f'Insufficient filled stock (need {-filled_delta}, have {s.filled_qty})')
    if new_e < 0:
        raise ValueError(f'Insufficient empty stock (need {-empty_delta}, have {s.empty_qty})')
    s.filled_qty = new_f
    s.empty_qty  = new_e
    return s


def _add_history(session, product_id, firm_id, action, details=''):
    session.add(ProductHistory(
        product_id=product_id, firm_id=firm_id,
        date=date.today(), action=action, details=details
    ))


def _serialize_customer(c):
    return {
        'id':                 c.id,
        'name':               c.name,
        'phone':              c.phone,
        'address':            c.address,
        'plans':              c.get_plans(),
        'lastPlanChangeDate': c.last_plan_change_date.isoformat()
                              if c.last_plan_change_date else None,
    }


def _serialize_transaction(t):
    return {
        'id':         t.id,
        'customerId': t.customer_id,
        'date':       t.date.isoformat() if t.date else '',
        'items':      t.get_items(),
        'total':      t.total,
        'status':     t.status,
    }


def _serialize_inv_log(l):
    return {
        'id':      l.id,
        'date':    l.date.isoformat() if l.date else '',
        'type':    l.log_type,
        'vehicle': l.vehicle or '',
        'items':   l.get_items(),
    }


def _get_firm_data(session, firm_id):
    """Return the full payload the frontend needs for a firm."""
    firm = session.get(Firm, firm_id)
    if not firm:
        return None

    products = session.query(Product).filter_by(firm_id=firm_id, active=True).all()

    stock_dict = {}
    empty_dict = {}
    for p in products:
        sid = p.size_id
        stk = p.stock
        stock_dict[sid] = stk.filled_qty if stk else 0
        empty_dict[sid] = stk.empty_qty  if stk else 0

    customers = session.query(Customer).filter_by(firm_id=firm_id, active=True).all()
    txns      = (session.query(Transaction)
                 .filter_by(firm_id=firm_id)
                 .order_by(Transaction.id.desc()).all())
    logs      = (session.query(InventoryLog)
                 .filter_by(firm_id=firm_id)
                 .order_by(InventoryLog.id.desc()).all())

    return {
        'firm':          firm.to_dict(),
        'cylinderTypes': [{'id': p.size_id, 'label': p.label, 'price': p.price}
                          for p in products],
        'stock':         stock_dict,
        'emptyStock':    empty_dict,
        'customers':     [_serialize_customer(c) for c in customers],
        'transactions':  [_serialize_transaction(t) for t in txns],
        'inventoryLogs': [_serialize_inv_log(l) for l in logs],
    }


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html')


# ---------------------------------------------------------------------------
# Firms
# ---------------------------------------------------------------------------

@app.route('/api/firms', methods=['GET'])
def list_firms():
    s = Session()
    try:
        firms = s.query(Firm).order_by(Firm.id).all()
        return jsonify([f.to_dict() for f in firms])
    finally:
        Session.remove()


@app.route('/api/firms/<int:firm_id>', methods=['GET'])
def get_firm(firm_id):
    s = Session()
    try:
        data = _get_firm_data(s, firm_id)
        if data is None:
            return _err('Firm not found', 404)
        return jsonify(data)
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------

@app.route('/api/firms/<int:firm_id>/products', methods=['POST'])
def create_product(firm_id):
    s = Session()
    try:
        if not s.get(Firm, firm_id):
            return _err('Firm not found', 404)

        body = request.get_json(force=True) or {}
        size_id = (body.get('id') or body.get('size_id') or '').strip()
        label   = (body.get('label') or '').strip()
        price   = body.get('price')

        if not size_id or not label or price is None:
            return _err('id, label and price are required')
        price = float(price)

        if s.query(Product).filter_by(firm_id=firm_id, size_id=size_id, active=True).first():
            return _err(f"Product '{size_id}' already exists for this firm")

        p = Product(firm_id=firm_id, size_id=size_id, label=label, price=price)
        s.add(p)
        s.flush()
        s.add(Stock(product_id=p.id, filled_qty=0, empty_qty=0))
        _add_history(s, p.id, firm_id, 'Created', f'Initial Price: ₹{price}')
        s.commit()
        return jsonify(_get_firm_data(s, firm_id)), 201
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


@app.route('/api/firms/<int:firm_id>/products/<size_id>', methods=['PUT'])
def update_product(firm_id, size_id):
    s = Session()
    try:
        p = s.query(Product).filter_by(firm_id=firm_id, size_id=size_id, active=True).first()
        if not p:
            return _err('Product not found', 404)

        body   = request.get_json(force=True) or {}
        changes = []

        if 'label' in body and body['label'] != p.label:
            changes.append(f'Label: {p.label} -> {body["label"]}')
            p.label = body['label']
        if 'price' in body and float(body['price']) != p.price:
            changes.append(f'Price: ₹{p.price} -> ₹{body["price"]}')
            p.price = float(body['price'])

        if changes:
            _add_history(s, p.id, firm_id, 'Edited', ', '.join(changes))
        s.commit()
        return jsonify(_get_firm_data(s, firm_id))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


@app.route('/api/firms/<int:firm_id>/products/<size_id>/history', methods=['GET'])
def product_history(firm_id, size_id):
    s = Session()
    try:
        p = s.query(Product).filter_by(firm_id=firm_id, size_id=size_id).first()
        if not p:
            return _err('Product not found', 404)
        hist = (s.query(ProductHistory)
                .filter_by(product_id=p.id, firm_id=firm_id)
                .order_by(ProductHistory.id.desc()).all())
        return jsonify([{
            'id':        h.id,
            'productId': size_id,
            'date':      h.date.isoformat() if h.date else '',
            'action':    h.action,
            'details':   h.details or '',
        } for h in hist])
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Stock initialisation (bulk)
# ---------------------------------------------------------------------------

@app.route('/api/firms/<int:firm_id>/stock/init', methods=['POST'])
def init_stock(firm_id):
    """
    Body: [{ weight: "12kg", filled: 10, empty: 5 }, ...]
    Adds quantities to existing stock (does not overwrite).
    """
    s = Session()
    try:
        if not s.get(Firm, firm_id):
            return _err('Firm not found', 404)

        rows = request.get_json(force=True) or []
        today = date.today()
        changed = False

        for row in rows:
            weight = (row.get('weight') or '').strip()
            filled = int(row.get('filled', 0) or 0)
            empty  = int(row.get('empty',  0) or 0)
            if filled == 0 and empty == 0:
                continue

            size_id = weight.lower().replace(' ', '')
            p = s.query(Product).filter_by(firm_id=firm_id, size_id=size_id).first()
            is_new = p is None

            if is_new:
                p = Product(firm_id=firm_id, size_id=size_id,
                            label=f'{weight} Cylinder', price=0.0)
                s.add(p)
                s.flush()
                s.add(Stock(product_id=p.id, filled_qty=0, empty_qty=0))

            stk = s.query(Stock).filter_by(product_id=p.id).first()
            if not stk:
                stk = Stock(product_id=p.id, filled_qty=0, empty_qty=0)
                s.add(stk)

            stk.filled_qty += filled
            stk.empty_qty  += empty

            action = 'Created & Initialized' if is_new else 'Stock Adjusted'
            _add_history(s, p.id, firm_id, action,
                         f'Added {filled} Filled, {empty} Empty')
            changed = True

        if not changed:
            return _err('No quantities entered')

        s.commit()
        return jsonify(_get_firm_data(s, firm_id))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Inventory – Send empties / Receive filled
# ---------------------------------------------------------------------------

@app.route('/api/firms/<int:firm_id>/inventory/send', methods=['POST'])
def inventory_send(firm_id):
    """Send empty cylinders OUT for refilling. Body: { vehicle, items: {size_id: qty} }"""
    s = Session()
    try:
        if not s.get(Firm, firm_id):
            return _err('Firm not found', 404)

        body    = request.get_json(force=True) or {}
        items   = body.get('items', {})
        vehicle = (body.get('vehicle') or '').strip().upper()

        if not items:
            return _err('No items provided')
        if not vehicle:
            return _err('Vehicle number is required')

        # Validate first
        for size_id, qty in items.items():
            qty = int(qty)
            p   = _get_product_by_size(s, firm_id, size_id)
            if not p:
                return _err(f"Product '{size_id}' not found")
            stk = s.query(Stock).filter_by(product_id=p.id).first()
            avail = stk.empty_qty if stk else 0
            if avail < qty:
                return _err(
                    f'Not enough empty cylinders for {p.label}.\n\nOnly {avail} available.')

        # Apply
        for size_id, qty in items.items():
            qty = int(qty)
            p   = _get_product_by_size(s, firm_id, size_id)
            _adjust_stock(s, p.id, empty_delta=-qty)

        log = InventoryLog(firm_id=firm_id, date=date.today(),
                           log_type='OUT', vehicle=vehicle)
        log.set_items(items)
        s.add(log)
        s.commit()
        return jsonify(_get_firm_data(s, firm_id))
    except ValueError as e:
        s.rollback()
        return _err(str(e))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


@app.route('/api/firms/<int:firm_id>/inventory/receive', methods=['POST'])
def inventory_receive(firm_id):
    """Receive filled cylinders IN from supplier. Body: { vehicle, items: {size_id: qty} }"""
    s = Session()
    try:
        if not s.get(Firm, firm_id):
            return _err('Firm not found', 404)

        body    = request.get_json(force=True) or {}
        items   = body.get('items', {})
        vehicle = (body.get('vehicle') or '').strip().upper()

        if not items:
            return _err('No items provided')
        if not vehicle:
            return _err('Vehicle number is required')

        for size_id, qty in items.items():
            qty = int(qty)
            p   = _get_product_by_size(s, firm_id, size_id)
            if not p:
                return _err(f"Product '{size_id}' not found")
            _adjust_stock(s, p.id, filled_delta=qty)

        log = InventoryLog(firm_id=firm_id, date=date.today(),
                           log_type='IN', vehicle=vehicle)
        log.set_items(items)
        s.add(log)
        s.commit()
        return jsonify(_get_firm_data(s, firm_id))
    except ValueError as e:
        s.rollback()
        return _err(str(e))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------

@app.route('/api/firms/<int:firm_id>/customers', methods=['POST'])
def create_customer(firm_id):
    """
    Body: {
      name, phone, address, connectionMode: 'new'|'existing',
      rows: [{typeId: size_id, qty: int}]
    }
    'new'      → deduct filled stock, create a delivery transaction
    'existing' → add empty stock, create an inventory IN log
    """
    s = Session()
    try:
        if not s.get(Firm, firm_id):
            return _err('Firm not found', 404)

        body = request.get_json(force=True) or {}
        name   = (body.get('name') or '').strip().upper()
        phone  = (body.get('phone') or '').strip()
        address = (body.get('address') or '').strip().upper()
        mode   = body.get('connectionMode', 'new')
        rows   = body.get('rows', [])

        if not name:
            return _err('Name is required')
        if phone and (len(phone) != 10 or not phone.isdigit()):
            return _err('Phone must be 10 digits')
        if not rows:
            return _err('Please add at least one cylinder connection')

        # Aggregate rows by size_id
        plans_dict = {}
        for row in rows:
            sid = row.get('typeId', '').strip()
            qty = int(row.get('qty', 0) or 0)
            if sid and qty > 0:
                plans_dict[sid] = plans_dict.get(sid, 0) + qty

        if not plans_dict:
            return _err('Please add at least one cylinder connection')

        # Validate stock for 'new' connection
        if mode == 'new':
            for sid, qty in plans_dict.items():
                p   = _get_product_by_size(s, firm_id, sid)
                if not p:
                    return _err(f"Product '{sid}' not found")
                stk = s.query(Stock).filter_by(product_id=p.id).first()
                avail = stk.filled_qty if stk else 0
                if avail < qty:
                    return _err(
                        f'Insufficient stock for {p.label}. '
                        f'Required: {qty}, Available: {avail}')

        today = date.today()
        plans = [{'sizeId': sid, 'limit': qty} for sid, qty in plans_dict.items()]

        cust = Customer(firm_id=firm_id, name=name, phone=phone, address=address,
                        last_plan_change_date=today)
        cust.set_plans(plans)
        s.add(cust)
        s.flush()

        total_cost = 0.0

        if mode == 'new':
            txn_items = []
            for sid, qty in plans_dict.items():
                p = _get_product_by_size(s, firm_id, sid)
                _adjust_stock(s, p.id, filled_delta=-qty)
                total_cost += p.price * qty
                txn_items.append({
                    'type': sid, 'filled': qty, 'empty': 0,
                    'dueDate': '', 'returnedDate': ''
                })
            txn = Transaction(firm_id=firm_id, customer_id=cust.id,
                              date=today, total=total_cost, status='Delivered')
            txn.set_items(txn_items)
            s.add(txn)
        else:
            items_dict = {}
            for sid, qty in plans_dict.items():
                p = _get_product_by_size(s, firm_id, sid)
                if p:
                    _adjust_stock(s, p.id, empty_delta=qty)
                    items_dict[sid] = qty
            log = InventoryLog(firm_id=firm_id, date=today,
                               log_type='IN', vehicle='OLD CUST DEPOSIT')
            log.set_items(items_dict)
            s.add(log)

        s.commit()
        return jsonify(_get_firm_data(s, firm_id)), 201
    except ValueError as e:
        s.rollback()
        return _err(str(e))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


@app.route('/api/customers/<int:customer_id>/plans', methods=['PUT'])
def update_customer_plans(customer_id):
    """Body: { plans: [{sizeId, limit}] }"""
    s = Session()
    try:
        cust = s.get(Customer, customer_id)
        if not cust:
            return _err('Customer not found', 404)

        body = request.get_json(force=True) or {}
        plans = body.get('plans', [])
        if not plans:
            return _err('Must have at least one plan')

        cust.set_plans(plans)
        cust.last_plan_change_date = date.today()
        s.commit()
        return jsonify(_get_firm_data(s, cust.firm_id))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Transactions
# ---------------------------------------------------------------------------

@app.route('/api/firms/<int:firm_id>/transactions', methods=['POST'])
def create_transaction(firm_id):
    """
    Body: { customerId, items: [{type, filled, empty, dueDate}], total }
    Decrements filled stock for each delivered cylinder.
    Increments empty stock for each returned cylinder.
    """
    s = Session()
    try:
        if not s.get(Firm, firm_id):
            return _err('Firm not found', 404)

        body       = request.get_json(force=True) or {}
        customer_id = body.get('customerId')
        items      = body.get('items', [])
        total      = float(body.get('total', 0))

        if not items:
            return _err('No items provided')

        # Aggregate stock changes
        for item in items:
            filled = int(item.get('filled', 0) or 0)
            empty  = int(item.get('empty',  0) or 0)
            size_id = item.get('type', '')
            p = _get_product_by_size(s, firm_id, size_id)
            if not p:
                return _err(f"Product '{size_id}' not found")
            try:
                _adjust_stock(s, p.id, filled_delta=-filled, empty_delta=empty)
            except ValueError as e:
                return _err(str(e))

        txn = Transaction(firm_id=firm_id, customer_id=customer_id,
                          date=date.today(), total=total, status='Delivered')
        txn.set_items(items)
        s.add(txn)
        s.commit()
        return jsonify(_get_firm_data(s, firm_id)), 201
    except ValueError as e:
        s.rollback()
        return _err(str(e))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


@app.route('/api/transactions/<int:txn_id>/return', methods=['POST'])
def return_cylinders(txn_id):
    """
    Partial / full cylinder return.
    Body: { itemIdx: int, qty: int, newDueDate?: str }
    """
    s = Session()
    try:
        txn = s.get(Transaction, txn_id)
        if not txn:
            return _err('Transaction not found', 404)

        body        = request.get_json(force=True) or {}
        item_idx    = int(body.get('itemIdx', -1))
        qty_return  = int(body.get('qty', 0) or 0)
        new_due     = body.get('newDueDate', '')

        items = txn.get_items()
        if item_idx < 0 or item_idx >= len(items):
            return _err('Invalid item index')

        item    = items[item_idx]
        pending = int(item.get('filled', 0)) - int(item.get('empty', 0))

        if qty_return <= 0 or qty_return > pending:
            return _err('Invalid return quantity')

        # Add empties back to stock
        size_id = item.get('type', '')
        p = _get_product_by_size(s, txn.firm_id, size_id)
        if p:
            _adjust_stock(s, p.id, empty_delta=qty_return)

        item['empty'] = int(item.get('empty', 0)) + qty_return
        new_pending   = int(item['filled']) - int(item['empty'])

        if new_pending <= 0:
            item['empty']        = item['filled']   # cap
            item['returnedDate'] = date.today().isoformat()
        elif new_due:
            item['dueDate'] = new_due

        txn.set_items(items)
        s.commit()
        return jsonify(_get_firm_data(s, txn.firm_id))
    except ValueError as e:
        s.rollback()
        return _err(str(e))
    except Exception as e:
        s.rollback()
        return _err(str(e))
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Backup / Restore / Clear
# ---------------------------------------------------------------------------

@app.route('/api/backup', methods=['GET'])
def backup():
    s = Session()
    try:
        payload = {
            'backup_version': 2,
            'exported_at':    date.today().isoformat(),
            'firms':     [f.to_dict() for f in s.query(Firm).all()],
            'products':  [p.to_dict() for p in s.query(Product).all()],
            'stocks':    [st.to_dict() for st in s.query(Stock).all()],
            'customers': [c.to_dict() for c in s.query(Customer).all()],
            'transactions': [t.to_dict() for t in s.query(Transaction).all()],
            'inventory_logs': [l.to_dict() for l in s.query(InventoryLog).all()],
            'product_history': [h.to_dict() for h in s.query(ProductHistory).all()],
        }
        return jsonify(payload)
    finally:
        Session.remove()


@app.route('/api/restore', methods=['POST'])
def restore():
    s = Session()
    try:
        data = request.get_json(force=True) or {}
        if data.get('backup_version') not in (1, 2):
            return _err('Invalid backup file')

        # Clear operational data
        for model in (ProductHistory, InventoryLog, Transaction,
                      Customer, Stock, Product):
            s.query(model).delete()
        s.flush()

        for p in data.get('products', []):
            s.add(Product(id=p['id'], firm_id=p['firm_id'], size_id=p['size_id'],
                          label=p['label'], price=p['price'],
                          active=p.get('active', True)))
        s.flush()

        for st in data.get('stocks', []):
            s.add(Stock(product_id=st['product_id'],
                        filled_qty=st['filled_qty'], empty_qty=st['empty_qty']))

        for c in data.get('customers', []):
            cust = Customer(id=c['id'], firm_id=c['firm_id'],
                            name=c['name'], phone=c.get('phone',''),
                            address=c.get('address',''),
                            active=c.get('active', True))
            if c.get('lastPlanChangeDate'):
                from datetime import date as _date
                cust.last_plan_change_date = _date.fromisoformat(c['lastPlanChangeDate'])
            cust.set_plans(c.get('plans', []))
            s.add(cust)

        for t in data.get('transactions', []):
            txn = Transaction(id=t['id'], firm_id=t['firm_id'],
                              customer_id=t.get('customerId'),
                              total=t['total'], status=t.get('status','Delivered'))
            if t.get('date'):
                from datetime import date as _date
                txn.date = _date.fromisoformat(t['date'])
            txn.set_items(t.get('items', []))
            s.add(txn)

        for l in data.get('inventory_logs', []):
            log = InventoryLog(id=l['id'], firm_id=l['firm_id'],
                               log_type=l.get('type','IN'),
                               vehicle=l.get('vehicle',''))
            if l.get('date'):
                from datetime import date as _date
                log.date = _date.fromisoformat(l['date'])
            log.set_items(l.get('items', {}))
            s.add(log)

        for h in data.get('product_history', []):
            ph = ProductHistory(id=h['id'], product_id=h['productId'],
                                firm_id=h['firm_id'], action=h['action'],
                                details=h.get('details',''))
            if h.get('date'):
                from datetime import date as _date
                ph.date = _date.fromisoformat(h['date'])
            s.add(ph)

        s.commit()
        return jsonify({'status': 'restored'})
    except Exception as e:
        s.rollback()
        return _err(f'Restore failed: {e}', 500)
    finally:
        Session.remove()


@app.route('/api/clear', methods=['POST'])
def clear_data():
    body = request.get_json(force=True) or {}
    if body.get('confirm') != 'CLEAR_ALL_DATA':
        return _err("Send { confirm: 'CLEAR_ALL_DATA' } to confirm")

    s = Session()
    try:
        for model in (ProductHistory, InventoryLog, Transaction,
                      Customer, Stock, Product):
            s.query(model).delete()
        s.flush()

        # Re-seed default products with zero stock
        from models import DEFAULT_PRODUCTS, seed_db
        s.commit()
        seed_db(Session)
        return jsonify({'status': 'cleared'})
    except Exception as e:
        s.rollback()
        return _err(str(e), 500)
    finally:
        Session.remove()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(host='0.0.0.0', debug=False, port=port)
