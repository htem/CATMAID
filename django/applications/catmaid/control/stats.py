import json
import time
from datetime import timedelta, datetime
from dateutil import parser as dateparser

from django.http import HttpResponse
from django.db.models.aggregates import Count
from django.db import connection

from catmaid.control.authentication import requires_user_role
from catmaid.control.common import get_relation_to_id_map
from catmaid.models import ClassInstance, Connector, Treenode, User, UserRole, \
        Review, Relation, TreenodeConnector


def _process(query, minus1name):
    cursor = connection.cursor()
    cursor.execute(query)

    # Get name dictonary separately to avoid joining the user table to the
    # treenode table, which in turn improves performance.
    names = dict(User.objects.values_list('id', 'username'))

    result = {'users': [],
              'values': []}
    for row in cursor.fetchall():
        result['values'].append(row[1])
        s = (names[row[0]], row[1]) if -1 != row[0] else (minus1name, row[1])
        result['users'].append('%s (%d)' % s)
    return HttpResponse(json.dumps(result), content_type='text/json')


@requires_user_role([UserRole.Annotate, UserRole.Browse])
def stats_nodecount(request, project_id=None):
    return _process('''
    SELECT user_id, count(*)
    FROM treenode
    WHERE project_id=%s
    GROUP BY user_id
    ''' % int(project_id), "*anonymous*")


@requires_user_role([UserRole.Annotate, UserRole.Browse])
def stats_editor(request, project_id=None):
    return _process('''
    SELECT editor_id, count(editor_id)
    FROM treenode
    WHERE project_id=%s
      AND editor_id != user_id
    GROUP BY username
    ''' % int(project_id), "*unedited*")


@requires_user_role([UserRole.Annotate, UserRole.Browse])
def stats_summary(request, project_id=None):
    startdate = datetime.today()
    result = {
        'treenodes_created': Treenode.objects.filter(
            project=project_id,
            user=request.user.id,
            creation_time__year=startdate.year,
            creation_time__month=startdate.month,
            creation_time__day=startdate.day).count(),
        'connectors_created': Connector.objects.filter(
            project=project_id,
            user=request.user.id,
            creation_time__year=startdate.year,
            creation_time__month=startdate.month,
            creation_time__day=startdate.day
            ).count(),
    }
    for key, class_name in [
            ('skeletons_created', 'skeleton')
            ]:
        result[key] = ClassInstance.objects.filter(
            project=project_id,
            user=request.user.id,
            creation_time__year=startdate.year,
            creation_time__month=startdate.month,
            creation_time__day=startdate.day,
            class_column__class_name=class_name).count()
    return HttpResponse(json.dumps(result), content_type='text/json')


@requires_user_role([UserRole.Annotate, UserRole.Browse])
def stats_history(request, project_id=None):
    # Get the start and end dates for the query, defaulting to the last 30
    # days.
    start_date = request.GET.get('start_date', datetime.now() - timedelta(30))
    end_date = request.GET.get('end_date', datetime.now())

    # Look up all tree nodes for the project in the given date range.
    # Also add a computed field which is just the day of the last edited
    # date/time.
    tree_nodes = Treenode.objects \
        .filter(
            project=project_id,
            edition_time__range=(start_date, end_date)) \
        .extra(select={
            'date': 'to_char("treenode"."edition_time", \'YYYYMMDD\')'}) \
        .order_by('user', 'date')

    # Get the count of tree nodes for each user/day combination.
    stats = tree_nodes.values('user__username', 'date') \
        .annotate(count=Count('id'))

    # Change the 'user__username' field name to just 'name'.
    # (If <https://code.djangoproject.com/ticket/12222> ever gets implemented
    # then this wouldn't be necessary.)
    stats = [{
        'name': stat['user__username'],
        'date': stat['date'],
        'count': stat['count']} for stat in stats]

    return HttpResponse(json.dumps(stats), content_type='text/json')

def stats_user_activity(request, project_id=None):
    username = request.GET.get('username', None)
    all_users = User.objects.filter().values('username', 'id')
    map_name_to_userid = {}
    for user in all_users:
        map_name_to_userid[user['username']] = user['id']
    relations = dict((r.relation_name, r.id) for r in Relation.objects.filter(project=project_id))
    # Retrieve all treenodes and creation time
    stats = Treenode.objects \
        .filter(
            project=project_id,
            user=map_name_to_userid[username] ) \
        .order_by('creation_time') \
        .values('creation_time')
    # Extract the timestamps from the datetime objects
    timepoints = [time.mktime(ele['creation_time'].timetuple()) for ele in stats]
    # Retrieve TreenodeConnector creation times
    stats_prelink = TreenodeConnector.objects \
        .filter(
            project=project_id,
            user=map_name_to_userid[username],
            relation=relations['presynaptic_to'] ) \
        .order_by('creation_time').values('creation_time')
    stats_postlink = TreenodeConnector.objects \
        .filter(
            project=project_id,
            user=map_name_to_userid[username],
            relation=relations['postsynaptic_to'] ) \
        .order_by('creation_time').values('creation_time')
    prelinks = [time.mktime(ele['creation_time'].timetuple()) for ele in stats_prelink]
    postlinks = [time.mktime(ele['creation_time'].timetuple()) for ele in stats_postlink]
    return HttpResponse(json.dumps({'skeleton_nodes': timepoints,
         'presynaptic': prelinks, 'postsynaptic': postlinks}), content_type='text/json')

def stats_user_history(request, project_id=None):
    # Get the start date for the query, defaulting to 10 days ago.
    start_date = request.GET.get('start_date', None)
    if start_date:
        start_date = dateparser.parse(start_date)
        print(start_date)
    else:
        start_date = datetime.now() - timedelta(10)
    # Get the end date for the query, defaulting to now.
    end_date = request.GET.get('end_date', None)
    if end_date:
        # We need to set the end date to the last second of the day to get all
        # events.
        end_date = dateparser.parse(end_date) + timedelta(days=1) - timedelta(seconds=1)
    else:
        end_date = datetime.now()
    # Calculate number of days between (including) start and end
    daydelta = (end_date + timedelta(days=1) - start_date).days

    all_users = User.objects.filter().values_list('id', flat=True)
    days = []
    daysformatted = []
    for i in range(daydelta):
        tmp_date = start_date + timedelta(days=i)
        days.append(tmp_date.strftime("%Y%m%d"))
        daysformatted.append(tmp_date.strftime("%a %d, %h %Y"))
    stats_table = {}
    for userid in all_users:
        if userid == -1:
            continue
        userid = str(userid)
        stats_table[userid] = {}
        for i in range(daydelta):
            date = (start_date + timedelta(days=i)).strftime("%Y%m%d")
            stats_table[userid][date] = {}

    # Look up all tree nodes for the project in the given date range. Also add
    # a computed field which is just the day of the last edited date/time.
    treenode_stats = []
    cursor = connection.cursor()

    cursor.execute('''
SELECT t.uid, t.day, round(sum(t.edge))
FROM (SELECT child.user_id as uid,
             date_trunc('day', child.creation_time) as day,
             sqrt(  pow(child.location_x - parent.location_x, 2)
                  + pow(child.location_y - parent.location_y, 2)
                  + pow(child.location_z - parent.location_z, 2)) as edge
      FROM treenode child,
           treenode parent
      WHERE child.project_id = %(project_id)s
        AND child.parent_id = parent.id
        AND child.creation_time BETWEEN %(start_date)s AND %(end_date)s) as t
GROUP BY t.uid, t.day
    ''', dict(project_id=project_id, start_date=start_date, end_date=end_date))

    treenode_stats = cursor.fetchall()

    relations = get_relation_to_id_map(project_id, cursor=cursor)
    preId, postId = relations['presynaptic_to'], relations['postsynaptic_to']

    # Retrieve a list of how many completed connector relations a user has
    # created in a given time frame. A completed connector relation is either
    # one were a user created both the presynaptic and the postsynaptic side
    # (one of them in the given time frame) or if a user completes an existing
    # 'half connection'. To avoid duplicates, only links are counted, where the
    # second node is younger than the first one
    cursor.execute('''
        SELECT t1.user_id, (date_trunc('day', t1.creation_time)) AS date, count(*)
        FROM treenode_connector t1
        JOIN treenode_connector t2 ON t1.connector_id = t2.connector_id
        WHERE t1.project_id=%s
        AND t1.creation_time BETWEEN %s AND %s
        AND t1.relation_id <> t2.relation_id
        AND (t1.relation_id = %s OR t1.relation_id = %s)
        AND (t2.relation_id = %s OR t2.relation_id = %s)
        AND t1.creation_time > t2.creation_time
        GROUP BY t1.user_id, date
    ''', (project_id, start_date, end_date, preId, postId, preId, postId))
    connector_stats = cursor.fetchall()

    tree_reviewed_nodes = Review.objects \
        .filter(
            project_id=project_id,
            review_time__range=(start_date, end_date)) \
        .extra(select={'date': "date_trunc('day', review_time)"}) \
        .order_by('date') \
        .values_list('reviewer_id', 'date') \
        .annotate(count = Count('treenode'))

    for di in treenode_stats:
        user_id = str(di[0])
        date = di[1].strftime('%Y%m%d')
        stats_table[user_id][date]['new_treenodes'] = di[2]

    for di in connector_stats:
        user_id = str(di[0])
        date = di[1].strftime('%Y%m%d')
        stats_table[user_id][date]['new_connectors'] = di[2]

    for di in tree_reviewed_nodes:
        user_id = str(di[0])
        date = di[1].strftime('%Y%m%d')
        stats_table[user_id][date]['new_reviewed_nodes'] = di[2]

    return HttpResponse(json.dumps({
        'stats_table': stats_table,
        'days': days,
        'daysformatted': daysformatted}), content_type='text/json')

